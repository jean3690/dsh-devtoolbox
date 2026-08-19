/**
 * Network category: API-testing companions for `http_request` — parse a curl
 * command, decompose URLs, decode/verify JWTs, and sign HMAC digests. HMAC/JWT
 * use WebCrypto (globalThis.crypto.subtle, present in node ≥ 19 and browsers);
 * everything else is dependency-free.
 *
 * @module dsh-devtoolbox/tools/network
 */

import type { ToolFn, ToolResult } from './index.ts'
import { base64UrlDecode, base64UrlEncode } from './encode.ts'

/* ------------------------------------------------------------------ */
/* curl_parse: turn a curl command line into http_request arguments.   */
/* ------------------------------------------------------------------ */

/** Tokenize a shell command line, honouring single/double quotes and backslash escapes. */
export function tokenizeCommand(line: string): string[] {
  const tokens: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  let i = 0
  const push = (): void => {
    if (cur !== '' || quote !== null) { tokens.push(cur); cur = '' }
    quote = null
  }
  while (i < line.length) {
    const ch = line[i]!
    if (quote !== null) {
      if (ch === quote) push()
      else if (ch === '\\' && quote === '"' && i + 1 < line.length) { cur += line[i + 1]!; i++ }
      else cur += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === '\\' && i + 1 < line.length) {
      cur += line[i + 1]!; i++
    } else if (/\s/.test(ch)) {
      push()
    } else {
      cur += ch
    }
    i++
  }
  push()
  return tokens
}

function parseCurlTokens(all: string[]): { method: string; url: string; headers: string[]; body: string; insecure: boolean } {
  const tokens = /^(?:curl|wget)(?:\.exe)?$/i.test(all[0] ?? '') ? all.slice(1) : all
  let method = 'GET'
  let url = ''
  const headers: string[] = []
  const data: string[] = []
  let insecure = false
  let jsonMode = false
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!
    switch (tok) {
      case '-X': case '--request':
        method = tokens[++i]?.toUpperCase() ?? method
        break
      case '-H': case '--header':
        if (tokens[i + 1] !== undefined) headers.push(tokens[++i]!)
        break
      case '-d': case '--data': case '--data-binary': case '--data-raw':
        if (tokens[i + 1] !== undefined) data.push(tokens[++i]!)
        break
      case '--json':
        jsonMode = true
        if (tokens[i + 1] !== undefined) data.push(tokens[++i]!)
        break
      case '-u': case '--user':
        if (tokens[i + 1] !== undefined) {
          const cred = tokens[++i]!
          if (cred.includes(':')) headers.push(`Authorization: Basic ${btoa(cred)}`)
        }
        break
      case '-k': case '--insecure':
        insecure = true
        break
      case '-m': case '--max-time':
        i++
        break
      case '-s': case '--silent': case '-L': case '--location': case '--compressed': case '-v': case '--verbose': case '-g': case '--globoff':
        break
      default:
        if (tok.startsWith('--') && !tok.startsWith('--data') && !tok.startsWith('--request') && !tok.startsWith('--header') && !tok.startsWith('--user') && !tok.startsWith('--max')) {
          // Unknown long flag: try to skip an argument if it is not a URL.
          if (url === '' && i + 1 < tokens.length && !tokens[i + 1]!.startsWith('-')) i++
        } else if (tok.startsWith('-') && tok.length > 1) {
          // Short flag bundle or unknown flag; skip a following value conservatively.
          if (url === '' && i + 1 < tokens.length && !tokens[i + 1]!.startsWith('-')) i++
        } else if (url === '') {
          url = tok
        }
    }
  }
  if (url === '') url = tokens.find(t => t.startsWith('http')) ?? ''
  let body = data.join('&')
  if (jsonMode && !headers.some(h => /^content-type:/i.test(h))) headers.unshift('Content-Type: application/json')
  if (data.length > 0 && method === 'GET') method = 'POST'
  return { method, url, headers, body, insecure }
}

export const curl_parse: ToolFn = {
  id: 'curl_parse',
  nameKey: 'tool.curl_parse',
  descKey: 'tool.curl_parse.desc',
  category: 'network',
  args: {
    text: { type: 'string', required: true, description: 'a curl command line' },
  },
  run({ text }): ToolResult {
    const tokens = tokenizeCommand(String(text))
    const parsed = parseCurlTokens(tokens)
    if (parsed.url === '') return { kind: 'text', text: 'Error: no URL found in the curl command' }
    const headers: Record<string, string> = {}
    for (const h of parsed.headers) {
      const idx = h.indexOf(':')
      if (idx > 0) headers[h.slice(0, idx).trim()] = h.slice(idx + 1).trim()
    }
    return {
      kind: 'json',
      json: {
        method: parsed.method,
        url: parsed.url,
        headers,
        body: parsed.body,
        insecure: parsed.insecure,
        hint: 'Feed these into http_request (url, method, headers, body).',
      },
    }
  },
}

/* ------------------------------------------------------------------ */
/* url_parse: decompose a URL into its parts.                          */
/* ------------------------------------------------------------------ */

export const url_parse: ToolFn = {
  id: 'url_parse',
  nameKey: 'tool.url_parse',
  descKey: 'tool.url_parse.desc',
  category: 'network',
  args: {
    url: { type: 'string', required: true, description: 'URL to decompose' },
  },
  run({ url }): ToolResult {
    try {
      const u = new URL(String(url))
      const query: Record<string, string> = {}
      for (const [k, v] of u.searchParams.entries()) query[k] = v
      return {
        kind: 'json',
        json: {
          protocol: u.protocol.replace(/:$/, ''),
          host: u.host,
          hostname: u.hostname,
          port: u.port === '' ? null : Number(u.port),
          pathname: u.pathname,
          hash: u.hash === '' ? null : u.hash.slice(1),
          username: u.username === '' ? null : u.username,
          origin: u.origin,
          query,
        },
      }
    } catch {
      return { kind: 'text', text: 'Error: invalid URL' }
    }
  },
}

/* ------------------------------------------------------------------ */
/* jwt: decode and (optionally) verify a JWT.                          */
/* ------------------------------------------------------------------ */

function jwtSignatureBytes(token: string): Uint8Array | null {
  const seg = token.split('.')[2]
  if (seg === undefined) return null
  const t0 = seg.replace(/-/g, '+').replace(/_/g, '/')
  let t = t0
  while (t.length % 4 !== 0) t += '='
  try {
    const bin = atob(t)
    return Uint8Array.from(bin, ch => ch.charCodeAt(0))
  } catch {
    return null
  }
}

async function hmacSha(alg: 'HS256' | 'HS384' | 'HS512', data: string, secret: string): Promise<Uint8Array> {
  const hashName = { HS256: 'SHA-256', HS384: 'SHA-384', HS512: 'SHA-512' }[alg]!
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: hashName }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return new Uint8Array(sig)
}

export const jwt: ToolFn = {
  id: 'jwt',
  nameKey: 'tool.jwt',
  descKey: 'tool.jwt.desc',
  category: 'network',
  args: {
    token: { type: 'string', required: true, description: 'JWT (header.payload.signature)' },
    secret: { type: 'string', description: 'HMAC secret to verify HS256/384/512 signatures' },
  },
  async run({ token, secret }): Promise<ToolResult> {
    const t = String(token).trim()
    const parts = t.split('.')
    if (parts.length !== 3) return { kind: 'text', text: 'Error: not a JWT (expected header.payload.signature)' }
    const [header, payload, signature] = parts as [string, string, string]
    const headerJson = base64UrlDecode(header)
    const payloadJson = base64UrlDecode(payload)
    if (headerJson === null || payloadJson === null) return { kind: 'text', text: 'Error: malformed base64 segment' }
    let parsedHeader: Record<string, unknown> | null = null
    let parsedPayload: Record<string, unknown> | null = null
    try { parsedHeader = JSON.parse(headerJson) } catch { /* below */ }
    try { parsedPayload = JSON.parse(payloadJson) } catch { /* below */ }
    if (parsedHeader === null || parsedPayload === null) return { kind: 'text', text: 'Error: header or payload is not valid JSON' }

    const alg = String(parsedHeader['alg'] ?? '')
    let verified: boolean | null = null
    if (alg === 'none') {
      verified = signature === ''
    } else if (secret !== undefined && secret !== '') {
      const hs = { HS256: 32, HS384: 48, HS512: 64 }[alg as 'HS256' | 'HS384' | 'HS512']
      if (hs !== undefined) {
        const expected = await hmacSha(alg as 'HS256' | 'HS384' | 'HS512', `${header}.${payload}`, String(secret))
        const actual = jwtSignatureBytes(t)
        const hex = (u: Uint8Array): string => [...u].map(b => b.toString(16).padStart(2, '0')).join('')
        verified = actual !== null && hex(actual) === hex(expected)
      } else if (alg.startsWith('RS') || alg.startsWith('ES')) {
        verified = null
      }
    } else {
      verified = null
    }

    const now = Math.floor(Date.now() / 1000)
    const exp = typeof parsedPayload['exp'] === 'number' ? parsedPayload['exp'] : null
    const nbf = typeof parsedPayload['nbf'] === 'number' ? parsedPayload['nbf'] : null
    const expired = exp !== null && exp < now
    const notYet = nbf !== null && nbf > now
    return {
      kind: 'json',
      json: {
        header: parsedHeader,
        payload: parsedPayload,
        algorithm: alg === '' ? null : alg,
        verified,
        signature: signature === '' ? null : signature,
        expired,
        notYet,
        exp: exp === null ? null : new Date(exp * 1000).toISOString(),
        hint: verified === null && alg !== 'none' ? 'pass secret=… to verify an HS* signature (RS/ES need a public key, not supported here)' : undefined,
      },
    }
  },
}

/* ------------------------------------------------------------------ */
/* hmac: compute an HMAC digest.                                       */
/* ------------------------------------------------------------------ */

const HMAC_ALGS = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'] as const

export const hmac: ToolFn = {
  id: 'hmac',
  nameKey: 'tool.hmac',
  descKey: 'tool.hmac.desc',
  category: 'network',
  args: {
    text: { type: 'string', required: true, description: 'message to sign' },
    key: { type: 'string', required: true, description: 'HMAC secret key' },
    algorithm: { type: 'string', default: 'SHA-256', description: 'SHA-1 | SHA-256 | SHA-384 | SHA-512' },
    format: { type: 'string', default: 'hex', description: 'hex | base64' },
  },
  async run({ text, key, algorithm, format }): Promise<ToolResult> {
    const alg = String(algorithm).toUpperCase()
    if (!HMAC_ALGS.includes(alg as (typeof HMAC_ALGS)[number])) {
      return { kind: 'text', text: `Error: unsupported algorithm "${alg}" (use ${HMAC_ALGS.join(' / ')})` }
    }
    try {
      const importKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(key)), { name: 'HMAC', hash: alg }, false, ['sign'])
      const sig = await crypto.subtle.sign('HMAC', importKey, new TextEncoder().encode(String(text)))
      const bytes = new Uint8Array(sig)
      if (format === 'base64') {
        let bin = ''
        for (const b of bytes) bin += String.fromCharCode(b)
        return { kind: 'text', text: btoa(bin) }
      }
      return { kind: 'text', text: [...bytes].map(b => b.toString(16).padStart(2, '0')).join('') }
    } catch (error) {
      return { kind: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }
    }
  },
}

export const networkTools: readonly ToolFn[] = Object.freeze([
  curl_parse,
  url_parse,
  jwt,
  hmac,
])
