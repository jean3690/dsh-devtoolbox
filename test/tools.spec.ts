import { describe, expect, it } from 'vitest'
import { TOOLS, TOOL_BY_ID, AGENT_EXPOSABLE_IDS, coerceArgs } from '../src/tools/index.ts'
import { md5Hex } from '../src/tools/security.ts'

/** Helper: run a tool and unwrap to text for assertion. */
async function runText(id: string, args: Record<string, unknown>): Promise<string> {
  const tool = TOOL_BY_ID.get(id)
  if (tool === undefined) throw new Error(`unknown tool ${id}`)
  const result = await tool.run(coerceArgs(tool, args).ok ? (coerceArgs(tool, args) as { value: Record<string, unknown> }).value : args as Record<string, unknown>)
  if (result.kind !== 'text') throw new Error(`expected text result, got ${result.kind}`)
  return result.text
}

describe('registry', () => {
  it('has 35 tools across 8 categories with unique ids', () => {
    expect(TOOLS.length).toBe(35)
    const ids = TOOLS.map(t => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    const categories = new Set(TOOLS.map(t => t.category))
    expect(categories.size).toBe(8)
  })

  it('exposes a sane agent subset', () => {
    expect(AGENT_EXPOSABLE_IDS).toContain('json_format')
    expect(AGENT_EXPOSABLE_IDS).toContain('base64')
    expect(AGENT_EXPOSABLE_IDS).not.toContain('picker')
    expect(AGENT_EXPOSABLE_IDS).not.toContain('regex')
  })

  it('coerces args and reports missing required args', () => {
    const json = TOOL_BY_ID.get('json_format')!
    const ok = coerceArgs(json, { text: '{"a":1}', indent: '4' })
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.value.indent).toBe(4)
    const bad = coerceArgs(json, {})
    expect(bad.ok).toBe(false)
  })
})

describe('text tools', () => {
  it('text_stats counts metrics', async () => {
    const tool = TOOL_BY_ID.get('text_stats')!
    const result = await tool.run({ text: '你好 world\nsecond line' })
    expect(result.kind).toBe('table')
    if (result.kind === 'table') {
      const map = new Map(result.rows.map(r => [r[0], r[1]]))
      expect(map.get('characters')).toBe(20)
      expect(map.get('cjkCharacters')).toBe(2)
      expect(map.get('words')).toBe(4)
      expect(map.get('lines')).toBe(2)
    }
  })

  it('text_remove_blank drops blank lines', async () => {
    expect(await runText('text_remove_blank', { text: 'a\n\n  \nb\n' })).toBe('a\nb')
  })

  it('text_dedup keeps first occurrence and reports removed count', async () => {
    const out = await runText('text_dedup', { text: 'a\nb\na\nc' })
    expect(out.startsWith('a\nb\nc')).toBe(true)
    expect(out).toContain('removed 1 duplicate')
  })

  it('case_convert handles all target styles', async () => {
    const camel = await runText('case_convert', { text: 'hello_world fooBar', to: 'camel' })
    expect(camel).toBe('helloWorldFooBar')
    const snake = await runText('case_convert', { text: 'HelloWorld', to: 'snake' })
    expect(snake).toBe('hello_world')
    const pascal = await runText('case_convert', { text: 'hello-world', to: 'pascal' })
    expect(pascal).toBe('HelloWorld')
    const kebab = await runText('case_convert', { text: 'helloWorld', to: 'kebab' })
    expect(kebab).toBe('hello-world')
    const constant = await runText('case_convert', { text: 'helloWorld', to: 'constant' })
    expect(constant).toBe('HELLO_WORLD')
  })

  it('fullwidth converts both directions', async () => {
    expect(await runText('fullwidth', { text: 'ＡＢＣ，１２３', direction: 'toHalf' })).toBe('ABC,123')
    expect(await runText('fullwidth', { text: 'ABC,123', direction: 'toFull' })).toBe('ＡＢＣ，１２３')
  })

  it('cn_convert simplifies and traditionalizes', async () => {
    const t = await runText('cn_convert', { text: '汉字处理', direction: 's2t' })
    expect(t).toContain('漢')
    const s = await runText('cn_convert', { text: '漢字處理', direction: 't2s' })
    expect(s).toContain('汉')
  })

  it('regex finds matches with positions', async () => {
    const tool = TOOL_BY_ID.get('regex')!
    const result = await tool.run({ text: 'a1 b2 a3', pattern: '[ab]\\d', flags: 'g' })
    expect(result.kind).toBe('table')
    if (result.kind === 'table') expect(result.rows.length).toBe(3)
  })
})

describe('encode tools', () => {
  it('base64 round-trips UTF-8', async () => {
    const encoded = await runText('base64', { text: '你好，dsh!', direction: 'encode' })
    expect(encoded).toBe('5L2g5aW977yMZHNoIQ==')
    expect(await runText('base64', { text: encoded, direction: 'decode' })).toBe('你好，dsh!')
  })

  it('base64 url-safe', async () => {
    const out = await runText('base64', { text: 'a?b/c+d', direction: 'encode', urlSafe: true })
    expect(out).not.toContain('+')
    expect(out).not.toContain('/')
    expect(await runText('base64', { text: out, direction: 'decode', urlSafe: true })).toBe('a?b/c+d')
  })

  it('url encode/decode and query parse', async () => {
    expect(await runText('url', { text: 'a b&c=d', direction: 'encode' })).toBe('a%20b%26c%3Dd')
    expect(await runText('url', { text: 'a%20b%26c%3Dd', direction: 'decode' })).toBe('a b&c=d')
    const tool = TOOL_BY_ID.get('url')!
    const q = await tool.run({ text: 'a=1&b=hello%20world', direction: 'decode', mode: 'query' })
    expect(q.kind).toBe('json')
    if (q.kind === 'json') expect(q.json).toEqual({ a: '1', b: 'hello world' })
  })

  it('radix converts with BigInt', async () => {
    expect(await runText('radix', { value: '255', from: 10, to: 16 })).toBe('ff')
    expect(await runText('radix', { value: 'ff', from: 16, to: 10 })).toBe('255')
    expect(await runText('radix', { value: '9999999999999999999999', from: 10, to: 2 })).toBe(
      BigInt('9999999999999999999999').toString(2),
    )
  })

  it('timestamp converts both directions', async () => {
    const tool = TOOL_BY_ID.get('timestamp')!
    const result = await tool.run({ value: '0', from: 'seconds', tz: 'utc' })
    expect(result.kind).toBe('table')
    if (result.kind === 'table') {
      const map = new Map(result.rows.map(r => [r[0], r[1]]))
      expect(map.get('iso')).toBe('1970-01-01T00:00:00.000Z')
    }
  })

  it('html_entity escapes and unescapes', async () => {
    expect(await runText('html_entity', { text: '<a href="x">&\'</a>', direction: 'escape' }))
      .toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;')
    expect(await runText('html_entity', { text: '&#x4F60;&#22909;', direction: 'unescape' })).toBe('你好')
  })
})

describe('data tools', () => {
  it('json_format formats, minifies, validates', async () => {
    const formatted = await runText('json_format', { text: '{"a":1,"b":[1,2]}' })
    expect(formatted).toContain('\n')
    expect(await runText('json_format', { text: '{"a":1}', mode: 'minify' })).toBe('{"a":1}')
    expect(await runText('json_format', { text: '{bad', mode: 'validate' })).toContain('Invalid JSON')
  })

  it('json_csv both directions', async () => {
    const csv = await runText('json_csv', { text: '[{"a":1,"b":"x,y"},{"a":2,"b":"z"}]' })
    expect(csv).toBe('a,b\n1,"x,y"\n2,z')
    const tool = TOOL_BY_ID.get('json_csv')!
    const json = await tool.run({ text: csv, direction: 'csvToJson' })
    expect(json.kind).toBe('json')
    if (json.kind === 'json') expect(json.json).toEqual([{ a: '1', b: 'x,y' }, { a: '2', b: 'z' }])
  })

  it('text_diff marks changes', async () => {
    const out = await runText('text_diff', { text: 'a\nb\nc', other: 'a\nB\nc' })
    expect(out).toContain('-b')
    expect(out).toContain('+B')
  })
})

describe('security tools', () => {
  it('md5 matches RFC 1321 vectors', () => {
    expect(md5Hex('')).toBe('d41d8cd98f00b204e9800998ecf8427e')
    expect(md5Hex('abc')).toBe('900150983cd24fb0d6963f7d28e17f72')
    expect(md5Hex('The quick brown fox jumps over the lazy dog'))
      .toBe('9e107d9d372bb6826bd81d3542a419d6')
  })

  it('sha matches known vectors', async () => {
    const sha256 = await runText('sha', { text: 'abc', algorithm: 'SHA-256' })
    expect(sha256).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    const sha1 = await runText('sha', { text: 'abc', algorithm: 'SHA-1' })
    expect(sha1).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
  })

  it('uuid produces v4-shaped ids', async () => {
    const out = await runText('uuid', { count: 5 })
    for (const u of out.split('\n')) {
      expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    }
  })

  it('password respects sets and length', async () => {
    const out = await runText('password', { length: 12, sets: 'upper,digit' })
    const first = out.split('\n')[0]!
    expect(first).toMatch(/^[A-Z0-9]+$/)
    expect(first).toHaveLength(12)
  })

  it('random_num respects range and uniqueness', async () => {
    const out = await runText('random_num', { min: 1, max: 3, count: 3, unique: true })
    const nums = out.split(',').map(Number)
    expect(new Set(nums).size).toBe(3)
    expect(nums.every(n => n >= 1 && n <= 3)).toBe(true)
  })
})

describe('extract tools', () => {
  it('phone extracts and detects carriers', async () => {
    const tool = TOOL_BY_ID.get('phone')!
    const result = await tool.run({ text: '联系 13812345678 或 13812345678', unique: true })
    expect(result.kind).toBe('table')
    if (result.kind === 'table') {
      expect(result.rows.length).toBe(1)
      expect(result.rows[0]![0]).toBe('13812345678')
      expect(result.rows[0]![1]).toContain('移动')
    }
  })

  it('email extracts with dedup', async () => {
    const tool = TOOL_BY_ID.get('email')!
    const result = await tool.run({ text: 'a@b.com, c@d.cn, a@b.com' })
    expect(result.kind).toBe('table')
    if (result.kind === 'table') expect(result.rows.length).toBe(2)
  })

  it('ip_extract separates v4/v6', async () => {
    const tool = TOOL_BY_ID.get('ip_extract')!
    const result = await tool.run({ text: 'server 192.168.1.1 and 2001:db8::1' })
    expect(result.kind).toBe('table')
    if (result.kind === 'table') {
      const types = result.rows.map(r => r[0])
      expect(types).toContain('IPv4')
      expect(types).toContain('IPv6')
    }
  })
})

describe('convert tools', () => {
  it('money converts to Chinese uppercase', async () => {
    expect(await runText('money', { amount: '1234.56' })).toBe('壹仟贰佰叁拾肆元伍角陆分')
    expect(await runText('money', { amount: '100' })).toBe('壹佰元整')
    expect(await runText('money', { amount: '0.05' })).toBe('零元零伍分')
    expect(await runText('money', { amount: '100000000.01' })).toBe('壹亿元零壹分')
  })

  it('color converts hex/rgb/hsl', async () => {
    const tool = TOOL_BY_ID.get('color')!
    const result = await tool.run({ value: '#ff8040' })
    expect(result.kind).toBe('table')
    if (result.kind === 'table') {
      const map = new Map(result.rows.map(r => [r[0], r[1]]))
      expect(map.get('RGB')).toBe('rgb(255, 128, 64)')
      expect(map.get('HSL')).toBe('hsl(20, 100%, 63%)')
    }
  })
})

describe('reference tools', () => {
  it('http_codes looks up 404', async () => {
    const tool = TOOL_BY_ID.get('http_codes')!
    const result = await tool.run({ code: 404 })
    expect(result.kind).toBe('table')
    if (result.kind === 'table') expect(result.rows[0]![0]).toBe(404)
  })

  it('ports looks up 3306', async () => {
    const tool = TOOL_BY_ID.get('ports')!
    const result = await tool.run({ port: 3306 })
    expect(result.kind).toBe('table')
    if (result.kind === 'table') expect(result.rows[0]![1]).toBe('MySQL')
  })

  it('ascii covers 128 entries', async () => {
    const tool = TOOL_BY_ID.get('ascii')!
    const result = await tool.run({})
    expect(result.kind).toBe('table')
    if (result.kind === 'table') expect(result.rows.length).toBe(128)
  })

  it('picker picks from a list', async () => {
    const out = await runText('picker', { text: '甲\n乙\n丙\n丁', count: 2 })
    expect(out.split('\n')).toHaveLength(2)
  })
})
