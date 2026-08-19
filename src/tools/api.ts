/**
 * Network category: the `http_request` tool. Unlike the rest of the toolbox it
 * touches the network, so it runs on the host (command + agent tools) and in
 * the browser GUI subject to CORS. Everything else here stays dependency-free.
 *
 * @module dsh-devtoolbox/tools/api
 */

import type { ToolFn, ToolResult } from './index.ts'

/** Parse the `headers` arg: JSON object, `Key: value` lines, or `key=value` lines. */
export function parseHeaders(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (raw === undefined || raw === '') return out
  const trimmed = raw.trim()
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string' || typeof v === 'number') out[k] = String(v)
      }
      return out
    } catch {
      // fall through to line-based parsing
    }
  }
  for (const line of trimmed.split(/\r\n|\r|\n/)) {
    const m = line.match(/^\s*([^:=\s][^:=]*?)\s*[:=]\s*(.*?)\s*$/)
    if (m) out[m[1]!] = m[2]!
  }
  return out
}

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
const NO_BODY = new Set(['GET', 'HEAD'])

export const http_request: ToolFn = {
  id: 'http_request',
  nameKey: 'tool.http_request',
  descKey: 'tool.http_request.desc',
  category: 'network',
  args: {
    url: { type: 'string', required: true, description: 'request URL' },
    method: { type: 'string', default: 'GET', description: 'GET / POST / PUT / PATCH / DELETE / HEAD / OPTIONS' },
    headers: { type: 'string', description: 'extra headers: JSON object or "Key: value" lines' },
    body: { type: 'string', description: 'request body (not allowed for GET/HEAD)' },
    timeout: { type: 'number', default: 10000, description: 'timeout in ms (1-300000)' },
    maxBytes: { type: 'number', default: 512000, description: 'max response body bytes to keep' },
  },
  async run({ url, method, headers, body, timeout, maxBytes }): Promise<ToolResult> {
    const target = String(url).trim()
    const m = String(method).trim().toUpperCase() || 'GET'
    if (!/^https?:\/\//i.test(target)) {
      return { kind: 'text', text: 'Error: url must start with http:// or https://' }
    }
    if (!METHODS.has(m)) return { kind: 'text', text: `Error: unsupported method "${m}"` }
    if (NO_BODY.has(m) && String(body ?? '') !== '') {
      return { kind: 'text', text: `Error: ${m} requests cannot have a body` }
    }
    const init: RequestInit = { method: m, headers: parseHeaders(headers === undefined ? undefined : String(headers)) }
    if (!NO_BODY.has(m) && String(body ?? '') !== '') init.body = String(body)
    const ms = Math.max(1, Math.min(300_000, Math.floor(Number(timeout)) || 10_000))
    const limit = Math.max(1024, Math.min(10 * 1024 * 1024, Math.floor(Number(maxBytes)) || 512_000))
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ms)
    timer.unref?.()
    init.signal = controller.signal
    const t0 = Date.now()
    try {
      const res = await fetch(target, init)
      const timeMs = Date.now() - t0
      const resHeaders: Record<string, string> = {}
      res.headers.forEach((v, k) => { resHeaders[k] = v })
      let text = ''
      try {
        text = await res.text()
      } catch {
        text = '<unreadable body>'
      }
      const truncated = text.length > limit
      if (truncated) text = text.slice(0, limit) + '\n… (truncated)'
      return {
        kind: 'json',
        json: {
          status: res.status,
          statusText: res.statusText,
          timeMs,
          truncated,
          headers: resHeaders,
          body: text,
        },
      }
    } catch (err) {
      return { kind: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }
    } finally {
      controller.abort()
    }
  },
}

export const apiTools: readonly ToolFn[] = Object.freeze([http_request])
