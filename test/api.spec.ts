import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { parseHeaders, http_request } from '../src/tools/api.ts'
import { TOOL_BY_ID, TOOLS, coerceArgs } from '../src/tools/index.ts'

let server: Server
let base = ''

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/slow') return
    if (req.url === '/big') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('x'.repeat(10_000))
      return
    }
    if (req.url === '/echo') {
      let body = ''
      req.on('data', c => { body += c })
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ method: req.method, url: req.url, header: req.headers['x-test'] ?? null, body }))
      })
      return
    }
    if (req.url === '/nope') {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found')
      return
    }
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('hello ' + (req.url ?? ''))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  if (addr && typeof addr === 'object') base = `http://127.0.0.1:${addr.port}`
})

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()))
})

async function run(args: Record<string, unknown>) {
  const coerced = coerceArgs(http_request, args)
  return http_request.run(coerced.ok ? (coerced.value as never) : {})
}

describe('http_request', () => {
  it('sends a GET and returns status, headers and body', async () => {
    const res = await run({ url: base + '/hi' })
    expect(res.kind).toBe('json')
    if (res.kind === 'json') {
      const r = res.json as { status: number; statusText: string; headers: Record<string, string>; body: string; truncated: boolean; timeMs: number }
      expect(r.status).toBe(200)
      expect(r.body).toBe('hello /hi')
      expect(r.headers['content-type']).toBe('text/plain')
      expect(r.timeMs).toBeGreaterThanOrEqual(0)
      expect(r.truncated).toBe(false)
    }
  })

  it('reports non-2xx statuses without erroring', async () => {
    const res = await run({ url: base + '/nope' })
    expect(res.kind).toBe('json')
    if (res.kind === 'json') {
      expect((res.json as { status: number }).status).toBe(404)
      expect((res.json as { body: string }).body).toBe('not found')
    }
  })

  it('posts a JSON body with custom headers', async () => {
    const res = await run({
      url: base + '/echo',
      method: 'POST',
      headers: 'Content-Type: application/json\nX-Test: abc',
      body: '{"a":1}',
    })
    expect(res.kind).toBe('json')
    if (res.kind === 'json') {
      const echo = res.json as { body: string; header: string | null }
      const parsed = JSON.parse(echo.body) as { method: string; header: string | null; body: string }
      expect(parsed.method).toBe('POST')
      expect(parsed.header).toBe('abc')
      expect(parsed.body).toBe('{"a":1}')
    }
  })

  it('accepts headers as a JSON object', async () => {
    const res = await run({ url: base + '/echo', headers: '{"X-Test": "json-hd"}' })
    expect(res.kind).toBe('json')
    if (res.kind === 'json') {
      const parsed = JSON.parse((res.json as { body: string }).body) as { header: string | null }
      expect(parsed.header).toBe('json-hd')
    }
  })

  it('sends HEAD requests without a body', async () => {
    const res = await run({ url: base + '/hi', method: 'HEAD' })
    expect(res.kind).toBe('json')
    if (res.kind === 'json') {
      expect((res.json as { status: number }).status).toBe(200)
    }
  })

  it('rejects GET with a body, bad urls and unknown methods', async () => {
    expect(await run({ url: base + '/hi', method: 'GET', body: 'x' })).toEqual(
      { kind: 'text', text: 'Error: GET requests cannot have a body' },
    )
    expect(await run({ url: 'file:///etc/passwd' })).toEqual(
      { kind: 'text', text: 'Error: url must start with http:// or https://' },
    )
    expect(await run({ url: base + '/hi', method: 'BREW' })).toEqual(
      { kind: 'text', text: 'Error: unsupported method "BREW"' },
    )
  })

  it('aborts on timeout', async () => {
    const res = await run({ url: base + '/slow', timeout: 200 })
    expect(res.kind).toBe('text')
    if (res.kind === 'text') expect(res.text).toContain('Error:')
  }, 10_000)

  it('truncates oversized response bodies', async () => {
    const res = await run({ url: base + '/big', maxBytes: 5000 })
    expect(res.kind).toBe('json')
    if (res.kind === 'json') {
      const r = res.json as { body: string; truncated: boolean }
      expect(r.truncated).toBe(true)
      expect(r.body.length).toBeLessThan(5200)
      expect(r.body).toContain('(truncated)')
    }
  })

  it('is registered with a network category', () => {
    const tool = TOOL_BY_ID.get('http_request')!
    expect(TOOLS.includes(tool)).toBe(true)
    expect(tool.category).toBe('network')
    expect(tool.args.url?.required).toBe(true)
  })
})

describe('parseHeaders', () => {
  it('parses JSON objects', () => {
    expect(parseHeaders('{"a":"1","b":2}')).toEqual({ a: '1', b: '2' })
  })

  it('parses colon and equals lines', () => {
    expect(parseHeaders('Authorization: Bearer x\nX-K: v')).toEqual({ Authorization: 'Bearer x', 'X-K': 'v' })
    expect(parseHeaders('a=1\nb=2')).toEqual({ a: '1', b: '2' })
  })

  it('falls back to line parsing on invalid JSON', () => {
    expect(parseHeaders('{not json}')).toEqual({})
    expect(parseHeaders('')).toEqual({})
    expect(parseHeaders(undefined)).toEqual({})
  })
})
