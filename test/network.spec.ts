import { describe, expect, it } from 'vitest'
import { TOOL_BY_ID, coerceArgs } from '../src/tools/index.ts'
import { curl_parse, tokenizeCommand, url_parse } from '../src/tools/network.ts'

async function run(toolId: string, args: Record<string, unknown>) {
  const tool = TOOL_BY_ID.get(toolId)!
  const coerced = coerceArgs(tool, args)
  return tool.run(coerced.ok ? (coerced.value as never) : {})
}

describe('curl_parse', () => {
  it('parses a simple GET', async () => {
    const res = await run('curl_parse', { text: 'curl https://api.example.com/users' })
    expect(res.kind).toBe('json')
    if (res.kind === 'json') {
      const p = res.json as { method: string; url: string; headers: Record<string, string>; body: string }
      expect(p.method).toBe('GET')
      expect(p.url).toBe('https://api.example.com/users')
      expect(p.headers).toEqual({})
      expect(p.body).toBe('')
    }
  })

  it('parses -X -H -d and --json', async () => {
    const res = await run('curl_parse', { text: `curl -X POST -H "Authorization: Bearer abc" -H 'Content-Type: application/json' -d '{"a":1}' https://api.example.com/x` })
    expect(res.kind).toBe('json')
    if (res.kind === 'json') {
      const p = res.json as { method: string; headers: Record<string, string>; body: string }
      expect(p.method).toBe('POST')
      expect(p.headers).toEqual({ Authorization: 'Bearer abc', 'Content-Type': 'application/json' })
      expect(p.body).toBe('{"a":1}')
    }
    const jsonMode = await run('curl_parse', { text: `curl --json '{"b":2}' http://a.com/y` })
    if (jsonMode.kind === 'json') {
      const p = jsonMode.json as { method: string; headers: Record<string, string>; body: string }
      expect(p.method).toBe('POST')
      expect(p.headers['Content-Type']).toBe('application/json')
      expect(p.body).toBe('{"b":2}')
    }
  })

  it('handles quoting, -u and -k', async () => {
    const res = await run('curl_parse', { text: `curl -k -u 'user:p@ss' -d "a=1&b=hello world" 'https://x.com/api?q=1'` })
    expect(res.kind).toBe('json')
    if (res.kind === 'json') {
      const p = res.json as { method: string; url: string; headers: Record<string, string>; body: string; insecure: boolean }
      expect(p.method).toBe('POST')
      expect(p.url).toBe('https://x.com/api?q=1')
      expect(p.headers['Authorization']).toBe(`Basic ${btoa('user:p@ss')}`)
      expect(p.body).toBe('a=1&b=hello world')
      expect(p.insecure).toBe(true)
    }
  })

  it('errors without a URL', async () => {
    expect(await run('curl_parse', { text: 'curl -X GET' })).toEqual(
      { kind: 'text', text: 'Error: no URL found in the curl command' },
    )
  })
})

describe('tokenizeCommand', () => {
  it('splits on whitespace outside quotes', () => {
    expect(tokenizeCommand(`a b "c d" 'e f' g\\ h`)).toEqual(['a', 'b', 'c d', 'e f', 'g h'])
  })
})

describe('url_parse', () => {
  it('decomposes a full URL', async () => {
    const res = await run('url_parse', { url: 'https://user@example.com:8443/a/b?x=1&y=hello%20world#sec' })
    expect(res.kind).toBe('json')
    if (res.kind === 'json') {
      const p = res.json as { protocol: string; host: string; port: number; pathname: string; query: Record<string, string>; hash: string; username: string }
      expect(p.protocol).toBe('https')
      expect(p.host).toBe('example.com:8443')
      expect(p.port).toBe(8443)
      expect(p.pathname).toBe('/a/b')
      expect(p.query).toEqual({ x: '1', y: 'hello world' })
      expect(p.hash).toBe('sec')
      expect(p.username).toBe('user')
    }
  })

  it('rejects garbage', async () => {
    expect(await run('url_parse', { url: 'not a url' })).toEqual({ kind: 'text', text: 'Error: invalid URL' })
  })
})

describe('jwt', () => {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const payload = btoa(JSON.stringify({ sub: '123', exp: 1999999999 })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  async function sign(secret: string): Promise<string> {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${payload}`)))
    const bin = [...sig].map(b => String.fromCharCode(b)).join('')
    return `${header}.${payload}.${btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
  }

  it('decodes header and payload', async () => {
    const token = `${header}.${payload}.abc`
    const res = await run('jwt', { token })
    expect(res.kind).toBe('json')
    if (res.kind === 'json') {
      const p = res.json as { header: Record<string, unknown>; payload: Record<string, unknown>; algorithm: string }
      expect(p.header['alg']).toBe('HS256')
      expect(p.payload['sub']).toBe('123')
      expect(p.algorithm).toBe('HS256')
    }
  })

  it('verifies a valid signature and rejects a tampered one', async () => {
    const good = await run('jwt', { token: await sign('s3cret'), secret: 's3cret' })
    if (good.kind === 'json') expect((good.json as { verified: boolean }).verified).toBe(true)
    const bad = await run('jwt', { token: await sign('s3cret'), secret: 'wrong' })
    if (bad.kind === 'json') expect((bad.json as { verified: boolean }).verified).toBe(false)
  })

  it('reports expiry and malformed tokens', async () => {
    const expired = await run('jwt', { token: await sign('x'), secret: 'x' })
    if (expired.kind === 'json') expect((expired.json as { expired: boolean }).expired).toBe(false)
    expect(await run('jwt', { token: 'not.a.jwt.more' })).toEqual({ kind: 'text', text: 'Error: not a JWT (expected header.payload.signature)' })
    expect(await run('jwt', { token: '!!!.???.---' })).toEqual({ kind: 'text', text: 'Error: malformed base64 segment' })
  })
})

describe('hmac', () => {
  it('computes hex and base64 digests', async () => {
    const hex = await run('hmac', { text: 'hello', key: 'key', algorithm: 'SHA-256' })
    expect(hex.kind).toBe('text')
    if (hex.kind === 'text') expect(hex.text).toHaveLength(64)
    const b64 = await run('hmac', { text: 'hello', key: 'key', algorithm: 'SHA-256', format: 'base64' })
    expect(b64.kind).toBe('text')
    if (b64.kind === 'text') expect(b64.text.length).toBeGreaterThan(20)
  })

  it('rejects unknown algorithms', async () => {
    expect(await run('hmac', { text: 'x', key: 'y', algorithm: 'MD5' })).toEqual(
      { kind: 'text', text: 'Error: unsupported algorithm "MD5" (use SHA-1 / SHA-256 / SHA-384 / SHA-512)' },
    )
  })
})

describe('registration', () => {
  it('registers all four network tools', () => {
    for (const id of ['curl_parse', 'url_parse', 'jwt', 'hmac']) {
      expect(TOOL_BY_ID.get(id), id).toBeDefined()
    }
    expect([curl_parse, url_parse].map(t => t.id)).toEqual(['curl_parse', 'url_parse'])
  })
})