import { describe, expect, it } from 'vitest'
import { TOOLS, TOOL_BY_ID, AGENT_EXPOSABLE_IDS, coerceArgs, agentDescription, CATEGORIES } from '../src/tools/index.ts'
import { md5Hex } from '../src/tools/security.ts'
import { ZH, EN } from '../src/i18n.ts'

/** Helper: run a tool and unwrap to text for assertion. */
async function runText(id: string, args: Record<string, unknown>): Promise<string> {
  const tool = TOOL_BY_ID.get(id)
  if (tool === undefined) throw new Error(`unknown tool ${id}`)
  const result = await tool.run(coerceArgs(tool, args).ok ? (coerceArgs(tool, args) as { value: Record<string, unknown> }).value : args as Record<string, unknown>)
  if (result.kind !== 'text') throw new Error(`expected text result, got ${result.kind}`)
  return result.text
}

describe('registry', () => {
  it('has 52 tools across 9 categories with unique ids', () => {
    expect(TOOLS.length).toBe(52)
    const ids = TOOLS.map(t => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    const categories = new Set(TOOLS.map(t => t.category))
    expect(categories.size).toBe(9)
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

  it('coerceArgs coerces numbers and booleans and applies defaults', () => {
    const tool = TOOL_BY_ID.get('random_num')!
    const ok = coerceArgs(tool, { min: '5', max: '10.5', count: '3', unique: '1' })
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.value).toEqual({ min: 5, max: 10.5, count: 3, unique: true })
    const defs = coerceArgs(tool, {})
    expect(defs.ok).toBe(true)
    if (defs.ok) expect(defs.value).toEqual({ min: 1, max: 100, count: 1, unique: false })
    expect(coerceArgs(tool, { unique: '0' }).ok).toBe(true)
  })

  it('coerceArgs rejects non-numbers and non-booleans', () => {
    const tool = TOOL_BY_ID.get('random_num')!
    expect(coerceArgs(tool, { min: 'abc' }).ok).toBe(false)
    expect(coerceArgs(tool, { min: {} as never }).ok).toBe(false)
    expect(coerceArgs(tool, { unique: 'maybe' }).ok).toBe(false)
  })

  it('every tool and category key exists in both dictionaries', () => {
    for (const tool of TOOLS) {
      expect(ZH[tool.nameKey], `${tool.id} nameKey zh`).toBeDefined()
      expect(EN[tool.nameKey], `${tool.id} nameKey en`).toBeDefined()
      expect(ZH[tool.descKey], `${tool.id} descKey zh`).toBeDefined()
      expect(EN[tool.descKey], `${tool.id} descKey en`).toBeDefined()
    }
    for (const cat of CATEGORIES) {
      expect(ZH[cat.nameKey], `${cat.id} zh`).toBeDefined()
      expect(EN[cat.nameKey], `${cat.id} en`).toBeDefined()
    }
  })

  it('agentDescription lists args with types', () => {
    const radix = agentDescription(TOOL_BY_ID.get('radix')!)
    expect(radix).toContain('value:string')
    expect(radix).toContain('from?:number')
    expect(agentDescription(TOOL_BY_ID.get('ascii')!)).toMatch(/\(args: [^)]*\)$/)
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
      expect(map.get('paragraphs')).toBe(2)
      expect(map.get('sentences')).toBe(0)
      expect(map.get('utf8Bytes')).toBe(24)
    }
  })

  it('text_stats counts sentences and bytes', async () => {
    const tool = TOOL_BY_ID.get('text_stats')!
    const result = await tool.run({ text: '第一句。second! third?' })
    if (result.kind === 'table') {
      const map = new Map(result.rows.map(r => [r[0], r[1]]))
      expect(map.get('sentences')).toBe(3)
    }
  })

  it('text_stats handles empty input', async () => {
    const tool = TOOL_BY_ID.get('text_stats')!
    const result = await tool.run({ text: '' })
    expect(result.kind).toBe('table')
    if (result.kind === 'table') {
      const map = new Map(result.rows.map(r => [r[0], r[1]]))
      expect(map.get('characters')).toBe(0)
      expect(map.get('lines')).toBe(0)
      expect(map.get('words')).toBe(0)
      expect(map.get('paragraphs')).toBe(0)
    }
  })

  it('text_remove_blank drops blank lines', async () => {
    expect(await runText('text_remove_blank', { text: 'a\n\n  \nb\n' })).toBe('a\nb')
  })

  it('text_remove_blank can keep trailing whitespace', async () => {
    expect(await runText('text_remove_blank', { text: 'a  \n\nb\n', trim: false })).toBe('a  \nb')
  })

  it('text_dedup keeps first occurrence and reports removed count', async () => {
    const out = await runText('text_dedup', { text: 'a\nb\na\nc' })
    expect(out.startsWith('a\nb\nc')).toBe(true)
    expect(out).toContain('removed 1 duplicate')
  })

  it('text_dedup ignoreCase merges case variants', async () => {
    const out = await runText('text_dedup', { text: 'A\na\nB\nb', ignoreCase: true })
    expect(out.startsWith('A\nB')).toBe(true)
    expect(out).toContain('removed 2 duplicate')
  })

  it('case_change handles all styles', async () => {
    expect(await runText('case_change', { text: 'Hello World', style: 'upper' })).toBe('HELLO WORLD')
    expect(await runText('case_change', { text: 'Hello World', style: 'lower' })).toBe('hello world')
    expect(await runText('case_change', { text: 'hello world', style: 'title' })).toBe('Hello World')
    expect(await runText('case_change', { text: 'hello world. foo bar', style: 'sentence' })).toBe('Hello world. Foo bar')
  })

  it('text_ops reverses, sorts and reverses chars', async () => {
    expect(await runText('text_ops', { text: 'a\nb\nc', op: 'reverseLines' })).toBe('c\nb\na')
    expect(await runText('text_ops', { text: 'c\na\nb', op: 'sortLines' })).toBe('a\nb\nc')
    expect(await runText('text_ops', { text: '你好a', op: 'reverseChars' })).toBe('a好你')
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

  it('fullwidth converts CJK punctuation and ideographic space', async () => {
    expect(await runText('fullwidth', { text: '，。？！；：（）　x', direction: 'toHalf' })).toBe(',.?!;:() x')
    expect(await runText('fullwidth', { text: 'x ', direction: 'toFull' })).toBe('ｘ　')
  })

  it('cn_convert simplifies and traditionalizes', async () => {
    const t = await runText('cn_convert', { text: '汉字处理', direction: 's2t' })
    expect(t).toContain('漢')
    const s = await runText('cn_convert', { text: '漢字處理', direction: 't2s' })
    expect(s).toContain('汉')
  })

  it('cn_convert round-trips s2t → t2s', async () => {
    const t = await runText('cn_convert', { text: '汉字处理', direction: 's2t' })
    expect(await runText('cn_convert', { text: t, direction: 't2s' })).toBe('汉字处理')
  })

  it('fullwidth conversion is idempotent', async () => {
    const once = await runText('fullwidth', { text: '，ＡB　x', direction: 'toHalf' })
    expect(await runText('fullwidth', { text: once, direction: 'toHalf' })).toBe(once)
  })

  it('regex finds matches with positions', async () => {
    const tool = TOOL_BY_ID.get('regex')!
    const result = await tool.run({ text: 'a1 b2 a3', pattern: '[ab]\\d', flags: 'g' })
    expect(result.kind).toBe('table')
    if (result.kind === 'table') expect(result.rows.length).toBe(3)
  })

  it('regex reports capture groups', async () => {
    const tool = TOOL_BY_ID.get('regex')!
    const result = await tool.run({ text: 'ab12 cd34', pattern: '([a-z]+)(\\d+)', flags: 'g' })
    expect(result.kind).toBe('table')
    if (result.kind === 'table') {
      expect(result.rows[0]).toEqual(['ab12', 0, 'ab', '12'])
      expect(result.rows[1]).toEqual(['cd34', 5, 'cd', '34'])
    }
  })

  it('regex handles no match and invalid pattern', async () => {
    expect(await runText('regex', { text: 'abc', pattern: '\\d+' })).toBe('No match')
    expect(await runText('regex', { text: 'abc', pattern: '(' })).toContain('Error:')
  })

  it('line_convert switches between LF, CRLF and CR', async () => {
    expect(await runText('line_convert', { text: 'a\r\nb\nc\r', to: 'lf' })).toBe('a\nb\nc\n')
    expect(await runText('line_convert', { text: 'a\nb', to: 'crlf' })).toBe('a\r\nb')
    expect(await runText('line_convert', { text: 'a\nb', to: 'cr' })).toBe('a\rb')
  })

  it('escape handles js and json round trips', async () => {
    const js = await runText('escape', { text: "a'b\"c\nd", target: 'js', direction: 'escape' })
    expect(js).toBe("a\\'b\\\"c\\nd")
    expect(await runText('escape', { text: js, target: 'js', direction: 'unescape' })).toBe("a'b\"c\nd")
    const json = await runText('escape', { text: 'a"b\nc', target: 'json', direction: 'escape' })
    expect(json).toBe('"a\\"b\\nc"')
    expect(await runText('escape', { text: json, target: 'json', direction: 'unescape' })).toBe('a"b\nc')
    expect(await runText('escape', { text: '\\u4f60', target: 'js', direction: 'unescape' })).toBe('你')
  })

  it('sort_lines sorts numerically, dedupes and counts frequency', async () => {
    expect(await runText('sort_lines', { text: '10\n2\n1', action: 'sort', numeric: true })).toBe('1\n2\n10')
    expect(await runText('sort_lines', { text: 'b\na\nb', action: 'uniq' })).toBe('b\na')
    const freq = await TOOL_BY_ID.get('sort_lines')!.run((coerceArgs(TOOL_BY_ID.get('sort_lines')!, { text: 'a\nb\na', action: 'freq', limit: 10 }) as { value: Record<string, unknown> }).value as never)
    expect(freq.kind).toBe('table')
    if (freq.kind === 'table') expect(freq.rows).toEqual([['a', 2], ['b', 1]])
    expect(await runText('sort_lines', { text: '1\n2\n3', action: 'reverse' })).toBe('3\n2\n1')
    expect(await runText('sort_lines', { text: 'A\nb\na', action: 'uniq', ignoreCase: true })).toBe('A\nb')
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

  it('base64 reports decode errors', async () => {
    expect(await runText('base64', { text: '@@@', direction: 'decode' })).toContain('Error:')
  })

  it('base64 round-trips large inputs via chunking', async () => {
    const big = 'x'.repeat(200_000) + '你好'
    const encoded = await runText('base64', { text: big })
    expect(encoded.length).toBeGreaterThan(big.length)
    expect(await runText('base64', { text: encoded, direction: 'decode' })).toBe(big)
  })

  it('url encode/decode and query parse', async () => {
    expect(await runText('url', { text: 'a b&c=d', direction: 'encode' })).toBe('a%20b%26c%3Dd')
    expect(await runText('url', { text: 'a%20b%26c%3Dd', direction: 'decode' })).toBe('a b&c=d')
    const tool = TOOL_BY_ID.get('url')!
    const q = await tool.run({ text: 'a=1&b=hello%20world', direction: 'decode', mode: 'query' })
    expect(q.kind).toBe('json')
    if (q.kind === 'json') expect(q.json).toEqual({ a: '1', b: 'hello world' })
  })

  it('url full mode keeps reserved characters', async () => {
    expect(await runText('url', { text: 'https://a.com/x y?z=1', direction: 'encode', mode: 'full' }))
      .toBe('https://a.com/x%20y?z=1')
    expect(await runText('url', { text: 'a=1&b=hello world', direction: 'encode', mode: 'query' }))
      .toBe('a=1&b=hello+world')
  })

  it('url handles repeated query keys and decode errors', async () => {
    const tool = TOOL_BY_ID.get('url')!
    const q = await tool.run({ text: 'a=1&a=2', direction: 'decode', mode: 'query' })
    expect(q.kind).toBe('json')
    if (q.kind === 'json') expect(q.json).toEqual({ a: '2' })
    expect(await runText('url', { text: '%zz', direction: 'decode' })).toContain('Error:')
  })

  it('unicode_escape round-trips astral and CJK', async () => {
    expect(await runText('unicode_escape', { text: '你好a\n', direction: 'escape' })).toBe('\\u4f60\\u597da\\u000a')
    expect(await runText('unicode_escape', { text: '\\u4f60\\u597d', direction: 'unescape' })).toBe('你好')
    expect(await runText('unicode_escape', { text: '𠀀', direction: 'escape' })).toBe('\\u{20000}')
    expect(await runText('unicode_escape', { text: '\\u{20000}', direction: 'unescape' })).toBe('𠀀')
  })

  it('radix converts with BigInt', async () => {
    expect(await runText('radix', { value: '255', from: 10, to: 16 })).toBe('ff')
    expect(await runText('radix', { value: 'ff', from: 16, to: 10 })).toBe('255')
    expect(await runText('radix', { value: '9999999999999999999999', from: 10, to: 2 })).toBe(
      BigInt('9999999999999999999999').toString(2),
    )
  })

  it('radix validates radix and digits', async () => {
    expect(await runText('radix', { value: '1', from: 37, to: 10 })).toBe('Error: radix must be 2-36')
    expect(await runText('radix', { value: 'xyz', from: 10, to: 16 })).toContain('not a valid base-10')
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

  it('timestamp auto-detects seconds and accepts millis/date', async () => {
    const tool = TOOL_BY_ID.get('timestamp')!
    const auto = await tool.run({ value: '1000000000', tz: 'utc' })
    if (auto.kind === 'table') {
      const map = new Map(auto.rows.map(r => [r[0], r[1]]))
      expect(map.get('unixSeconds')).toBe(1000000000)
      expect(map.get('iso')).toBe('2001-09-09T01:46:40.000Z')
    }
    const millis = await tool.run({ value: '1000', from: 'millis', tz: 'utc' })
    if (millis.kind === 'table') {
      const map = new Map(millis.rows.map(r => [r[0], r[1]]))
      expect(map.get('unixSeconds')).toBe(1)
    }
    const date = await tool.run({ value: '2024-01-01', tz: 'utc' })
    if (date.kind === 'table') {
      const map = new Map(date.rows.map(r => [r[0], r[1]]))
      expect(map.get('unixSeconds')).toBe(1704067200)
    }
  })

  it('timestamp rejects garbage input', async () => {
    expect(await runText('timestamp', { value: 'not-a-date' })).toContain('Error:')
  })

  it('timestamp renders local dates with wall-clock format', async () => {
    const tool = TOOL_BY_ID.get('timestamp')!
    const result = await tool.run({ value: '0', from: 'seconds', tz: 'local' })
    expect(result.kind).toBe('table')
    if (result.kind === 'table') {
      const map = new Map(result.rows.map(r => [r[0], r[1]]))
      expect(String(map.get('date'))).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    }
  })

  it('html_entity escapes and unescapes', async () => {
    expect(await runText('html_entity', { text: '<a href="x">&\'</a>', direction: 'escape' }))
      .toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;')
    expect(await runText('html_entity', { text: '&#x4F60;&#22909;', direction: 'unescape' })).toBe('你好')
  })

  it('html_entity unescapes mixed and numeric entities', async () => {
    expect(await runText('html_entity', { text: '&amp;lt;', direction: 'unescape' })).toBe('&lt;')
    expect(await runText('html_entity', { text: '&#65;&#x42;', direction: 'unescape' })).toBe('AB')
    expect(await runText('html_entity', { text: 'plain text 123', direction: 'escape' })).toBe('plain text 123')
  })

  it('data_url encodes with mime detection and decodes back', async () => {
    const out = await runText('data_url', { text: 'hello' })
    expect(out).toBe('data:text/plain;base64,aGVsbG8=')
    expect(await runText('data_url', { text: '{"a":1}', mime: 'application/json' })).toBe('data:application/json;base64,eyJhIjoxfQ==')
    expect(await runText('data_url', { text: 'hi', encoding: 'plain' })).toBe('data:text/plain,hi')
    const tool = TOOL_BY_ID.get('data_url')!
    const dec = await tool.run({ text: 'data:application/json;base64,eyJhIjoxfQ==' })
    expect(dec.kind).toBe('json')
    if (dec.kind === 'json') {
      const p = dec.json as { mime: string; text: string }
      expect(p.mime).toBe('application/json')
      expect(p.text).toBe('{"a":1}')
    }
    expect(await runText('data_url', { text: 'data:bad' })).toContain('Error:')
  })

  it('qrcode generates a PNG data URL', async () => {
    const tool = TOOL_BY_ID.get('qrcode')!
    const res = await tool.run({ text: 'https://example.com', size: 128 })
    expect(res.kind).toBe('json')
    if (res.kind === 'json') {
      const p = res.json as { dataUrl: string }
      expect(p.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
    }
    expect(await runText('qrcode', { text: '' })).toBe('Error: empty content')
  })
})

describe('data tools', () => {
  it('json_format formats, minifies, validates', async () => {
    const formatted = await runText('json_format', { text: '{"a":1,"b":[1,2]}' })
    expect(formatted).toContain('\n')
    expect(await runText('json_format', { text: '{"a":1}', mode: 'minify' })).toBe('{"a":1}')
    expect(await runText('json_format', { text: '{bad', mode: 'validate' })).toContain('Invalid JSON')
  })

  it('json_format respects indent and validates ok', async () => {
    expect(await runText('json_format', { text: '{"a":1}', indent: 4 })).toBe('{\n    "a": 1\n}')
    expect(await runText('json_format', { text: '{"a":1}', mode: 'validate' })).toBe('Valid JSON ✓')
  })

  it('json_csv both directions', async () => {
    const csv = await runText('json_csv', { text: '[{"a":1,"b":"x,y"},{"a":2,"b":"z"}]' })
    expect(csv).toBe('a,b\n1,"x,y"\n2,z')
    const tool = TOOL_BY_ID.get('json_csv')!
    const json = await tool.run({ text: csv, direction: 'csvToJson' })
    expect(json.kind).toBe('json')
    if (json.kind === 'json') expect(json.json).toEqual([{ a: '1', b: 'x,y' }, { a: '2', b: 'z' }])
  })

  it('json_csv rejects non-array and empty input', async () => {
    expect(await runText('json_csv', { text: '{"a":1}' })).toContain('must be an array')
    expect(await runText('json_csv', { text: '[]' })).toContain('empty array')
    expect(await runText('json_csv', { text: '', direction: 'csvToJson' })).toContain('empty CSV')
  })

  it('json_csv supports custom delimiters and nested values', async () => {
    expect(await runText('json_csv', { text: '[{"a":1,"b":"x"}]', delimiter: ';' })).toBe('a;b\n1;x')
    expect(await runText('json_csv', { text: '[{"a":{"n":1}}]' })).toBe('a\n"{""n"":1}"')
    const tool = TOOL_BY_ID.get('json_csv')!
    const json = await tool.run({ text: 'a\n"x""y"', direction: 'csvToJson' })
    expect(json.kind).toBe('json')
    if (json.kind === 'json') expect(json.json).toEqual([{ a: 'x"y' }])
  })

  it('csv_fix repairs latin-1 view mojibake', async () => {
    const mojibake = String.fromCharCode(...new TextEncoder().encode('水平'))
    expect(mojibake).toBe('æ°´å¹³')
    expect(await runText('csv_fix', { text: mojibake })).toBe('水平')
  })

  it('csv_fix can produce GBK mojibake on demand', async () => {
    const out = await runText('csv_fix', { text: '水平', direction: 'utf8ToGbk' })
    expect(out).not.toBe('水平')
  })

  it('text_diff marks changes', async () => {
    const out = await runText('text_diff', { text: 'a\nb\nc', other: 'a\nB\nc' })
    expect(out).toContain('-b')
    expect(out).toContain('+B')
  })

  it('text_diff identical inputs have no changes', async () => {
    const out = await runText('text_diff', { text: 'a\nb', other: 'a\nb' })
    expect(out).not.toContain('-')
    expect(out).not.toContain('+')
    expect(out).toBe(' a\n b')
  })

  it('text_diff full replacement emits both markers and a header', async () => {
    const out = await runText('text_diff', { text: 'a', other: 'b', context: 0 })
    expect(out).toContain('@@ -0,1 +0,1 @@')
    expect(out).toContain('-a')
    expect(out).toContain('+b')
  })

  it('text_diff folds a long unchanged run between two changes', async () => {
    const a = Array.from({ length: 30 }, (_, i) => i + 1).join('\n')
    const b = [1, 2, 3, 4, 5, 'X', 'Y', 'Z', 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 'W', 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30].join('\n')
    const out = await runText('text_diff', { text: a, other: b, context: 1 })
    expect(out).toContain('+X')
    expect(out).toContain('+W')
    expect(out).toContain(' 6')
    expect(out).toContain(' 15')
    expect(out).toContain('…')
    expect(out).not.toContain(' 7')
    expect(out).not.toContain(' 14')
  })

  it('text_diff does not fold trailing unchanged lines', async () => {
    const a = Array.from({ length: 10 }, (_, i) => i + 1).join('\n')
    const out = await runText('text_diff', { text: a, other: `${a}\n11`, context: 0 })
    expect(out).toContain('+11')
    expect(out).toContain(' 10')
    expect(out).not.toContain('…')
  })

  it('json_path extracts nested values, arrays and wildcards', async () => {
    const doc = '{"items":[{"name":"a","tags":["x","y"]}],"meta":{"ok":true}}'
    const tool = TOOL_BY_ID.get('json_path')!
    const item = await tool.run({ text: doc, path: '$.items[0].name' })
    expect(item.kind).toBe('json')
    if (item.kind === 'json') expect(item.json).toBe('a')
    const tags = await tool.run({ text: doc, path: '$.items[0].tags[*]' })
    if (tags.kind === 'json') expect(tags.json).toEqual(['x', 'y'])
    const meta = await tool.run({ text: doc, path: '$.*.ok' })
    if (meta.kind === 'json') expect(meta.json).toEqual([true])
    expect(await runText('json_path', { text: doc, path: '$.missing' })).toContain('Error: key "missing" not found')
    expect(await runText('json_path', { text: 'not json', path: '$' })).toContain('Error: invalid JSON')
    expect(await runText('json_path', { text: doc, path: 'items[0]' })).toContain('Error: path must start with $')
  })

  it('json_to_yaml converts both directions', async () => {
    const y = await runText('json_to_yaml', { text: '{"a":1,"b":[1,2]}' })
    expect(y).toContain('a: 1')
    expect(y).toContain('- 1')
    const tool = TOOL_BY_ID.get('json_to_yaml')!
    const back = await tool.run({ text: y, direction: 'yamlToJson' })
    expect(back.kind).toBe('json')
    if (back.kind === 'json') expect(back.json).toEqual({ a: 1, b: [1, 2] })
    expect(await runText('json_to_yaml', { text: '{bad' })).toContain('Error:')
    expect(await runText('json_to_yaml', { text: 'a: 1\n  b: x', direction: 'yamlToJson' })).toContain('Error:')
  })
})

describe('security tools', () => {
  it('md5 matches RFC 1321 vectors', () => {
    expect(md5Hex('')).toBe('d41d8cd98f00b204e9800998ecf8427e')
    expect(md5Hex('abc')).toBe('900150983cd24fb0d6963f7d28e17f72')
    expect(md5Hex('The quick brown fox jumps over the lazy dog'))
      .toBe('9e107d9d372bb6826bd81d3542a419d6')
  })

  it('md5 tool supports uppercase output', async () => {
    expect(await runText('md5', { text: 'abc', upper: true })).toBe('900150983CD24FB0D6963F7D28E17F72')
  })

  it('sha matches known vectors', async () => {
    const sha256 = await runText('sha', { text: 'abc', algorithm: 'SHA-256' })
    expect(sha256).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    const sha1 = await runText('sha', { text: 'abc', algorithm: 'SHA-1' })
    expect(sha1).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
  })

  it('sha covers SHA-512, aliases, uppercase and bad algorithms', async () => {
    expect(await runText('sha', { text: 'abc', algorithm: 'SHA-512' }))
      .toBe('ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a'
        + '2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f')
    expect(await runText('sha', { text: 'abc', algorithm: 'SHA256', upper: true })).toMatch(/^[0-9A-F]{64}$/)
    expect(await runText('sha', { text: 'abc', algorithm: 'MD6' })).toContain('Error:')
  })

  it('uuid produces v4-shaped ids', async () => {
    const out = await runText('uuid', { count: 5 })
    for (const u of out.split('\n')) {
      expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    }
  })

  it('uuid supports upper and no-hyphens', async () => {
    const upper = await runText('uuid', { count: 3, upper: true })
    for (const u of upper.split('\n')) expect(u).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/)
    const flat = await runText('uuid', { count: 2, noHyphens: true })
    for (const u of flat.split('\n')) {
      expect(u).toMatch(/^[0-9a-f]{32}$/)
      expect(u[12]).toBe('4')
    }
  })

  it('password respects sets and length', async () => {
    const out = await runText('password', { length: 12, sets: 'upper,digit' })
    const first = out.split('\n')[0]!
    expect(first).toMatch(/^[A-Z0-9]+$/)
    expect(first).toHaveLength(12)
  })

  it('password rejects empty charset sets', async () => {
    expect(await runText('password', { sets: 'emoji' })).toContain('Error:')
  })

  it('password clamps length and reports entropy', async () => {
    const out = await runText('password', { length: 200, count: 2 })
    const lines = out.split('\n')
    expect(lines[0]!).toHaveLength(128)
    expect(lines[1]!).toHaveLength(128)
    expect(out).toMatch(/entropy ≈ \d+ bits/)
  })

  it('password excludeAmbiguous drops lookalike characters', async () => {
    const out = await runText('password', { length: 20, count: 5, sets: 'lower,digit', excludeAmbiguous: true })
    const lines = out.split('\n').filter(l => !l.startsWith('<!--'))
    for (const line of lines) {
      expect(line).toHaveLength(20)
      expect(line).not.toMatch(/[0O1lI|]/)
    }
  })

  it('random_num respects range and uniqueness', async () => {
    const out = await runText('random_num', { min: 1, max: 3, count: 3, unique: true })
    const nums = out.split(',').map(Number)
    expect(new Set(nums).size).toBe(3)
    expect(nums.every(n => n >= 1 && n <= 3)).toBe(true)
  })

  it('random_num validates range and clamps unique count', async () => {
    expect(await runText('random_num', { min: 5, max: 1 })).toContain('Error:')
    const clamped = await runText('random_num', { min: 1, max: 2, count: 5, unique: true })
    expect(clamped.split(',')).toHaveLength(2)
  })

  it('crc32 computes a known checksum', async () => {
    expect(await runText('crc32', { text: 'hello' })).toBe('3610a686')
    expect(await runText('crc32', { text: '' })).toBe('00000000')
    expect(await runText('crc32', { text: '你好' })).toMatch(/^[0-9a-f]{8}$/)
  })

  it('crypto_encrypt round-trips AES-GCM', async () => {
    const tool = TOOL_BY_ID.get('crypto_encrypt')!
    const enc = await tool.run({ text: 'secret 你好', mode: 'encrypt', password: 'pw123' })
    expect(enc.kind).toBe('text')
    if (enc.kind !== 'text') return
    expect(enc.text).not.toContain('secret')
    const dec = await tool.run({ text: enc.text, mode: 'decrypt', password: 'pw123' })
    expect(dec.kind).toBe('text')
    if (dec.kind === 'text') expect(dec.text).toBe('secret 你好')
    const wrong = await tool.run({ text: enc.text, mode: 'decrypt', password: 'nope' })
    expect(wrong.kind).toBe('text')
    if (wrong.kind === 'text') expect(wrong.text).toContain('Error:')
  })

  it('crypto_encrypt validates args', async () => {
    expect(await runText('crypto_encrypt', { text: 'x', mode: 'encrypt' })).toBe('Error: AES needs a password (password=…)')
    expect(await runText('crypto_encrypt', { text: 'x', mode: 'encrypt', password: 'p', algorithm: 'blowfish' })).toContain('Error: unsupported algorithm')
    expect(await runText('crypto_encrypt', { text: 'x', mode: 'encrypt', algorithm: 'rsa' })).toContain('Error: RSA needs a PEM key')
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

  it('phone detects all three carriers and reports no match', async () => {
    const tool = TOOL_BY_ID.get('phone')!
    const carrier = async (n: string) => {
      const r = await tool.run({ text: n })
      return r.kind === 'table' ? String(r.rows[0]![1]) : ''
    }
    expect(await carrier('18612345678')).toBe('中国联通')
    expect(await carrier('17512345678')).toBe('中国联通')
    expect(await carrier('13312345678')).toBe('中国电信')
    expect(await carrier('19912345678')).toBe('中国电信')
    expect(await carrier('18912345678')).toBe('中国电信')
    expect(await carrier('13812345678')).toBe('中国移动')
    expect(await carrier('19512345678')).toBe('中国移动')
    expect(await carrier('17612345678')).toBe('中国联通')
    expect(await runText('phone', { text: 'no numbers here' })).toBe('No matches')
  })

  it('email extracts with dedup', async () => {
    const tool = TOOL_BY_ID.get('email')!
    const result = await tool.run({ text: 'a@b.com, c@d.cn, a@b.com' })
    expect(result.kind).toBe('table')
    if (result.kind === 'table') expect(result.rows.length).toBe(2)
  })

  it('email reports no matches', async () => {
    expect(await runText('email', { text: 'no emails here' })).toBe('No matches')
  })

  it('url_extract pulls http/https/ftp links', async () => {
    const tool = TOOL_BY_ID.get('url_extract')!
    const result = await tool.run({ text: 'see https://a.com/x?y=1 or ftp://f.cn/a.txt' })
    expect(result.kind).toBe('table')
    if (result.kind === 'table') {
      expect(result.rows.length).toBe(2)
      expect(result.rows[0]![0]).toBe('https://a.com/x?y=1')
      expect(result.rows[1]![0]).toBe('ftp://f.cn/a.txt')
    }
    expect(await runText('url_extract', { text: 'nothing' })).toBe('No matches')
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

  it('ip_extract can disable v6 and filters invalid v4', async () => {
    const tool = TOOL_BY_ID.get('ip_extract')!
    const result = await tool.run({ text: '192.168.1.1 999.999.1.1 2001:db8::1', includeV6: false })
    expect(result.kind).toBe('table')
    if (result.kind === 'table') {
      expect(result.rows.length).toBe(1)
      expect(result.rows[0]).toEqual(['IPv4', '192.168.1.1'])
    }
  })

  it('ip_extract handles v6-only input', async () => {
    const tool = TOOL_BY_ID.get('ip_extract')!
    const v6 = await tool.run({ text: '2001:db8::1' })
    expect(v6.kind).toBe('table')
    if (v6.kind === 'table') {
      expect(v6.rows.length).toBe(1)
      expect(v6.rows[0]![0]).toBe('IPv6')
    }
    expect(await runText('ip_extract', { text: '2001:db8::1', includeV6: false })).toBe('No matches')
  })

  it('id_card parses and validates 18-digit numbers', async () => {
    const tool = TOOL_BY_ID.get('id_card')!
    const result = await tool.run({ text: '110101199003071233' })
    expect(result.kind).toBe('table')
    if (result.kind === 'table') {
      expect(result.rows[0]).toEqual(['110101199003071233', '✓', '1990-03-07', 'male', '110101', '18-digit'])
    }
  })

  it('id_card converts 15-digit numbers and flags bad checksums', async () => {
    const tool = TOOL_BY_ID.get('id_card')!
    const ok15 = await tool.run({ text: '110101900307123' })
    expect(ok15.kind).toBe('table')
    if (ok15.kind === 'table') {
      expect(ok15.rows[0]![0]).toBe('110101199003071233')
      expect(ok15.rows[0]![1]).toBe('✓')
      expect(ok15.rows[0]![5]).toBe('from 15-digit')
    }
    const bad = await tool.run({ text: '110101199003071231' })
    expect(bad.kind).toBe('table')
    if (bad.kind === 'table') expect(bad.rows[0]![1]).toBe('✗')
    const invalid = await tool.run({ text: '12345' })
    expect(invalid.kind).toBe('table')
    if (invalid.kind === 'table') {
      expect(invalid.rows).toHaveLength(0)
      expect(invalid.note).toContain('not a valid')
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

  it('money handles negatives, zero and errors', async () => {
    expect(await runText('money', { amount: '-123.45' })).toBe('负壹佰贰拾叁元肆角伍分')
    expect(await runText('money', { amount: '0' })).toBe('零元整')
    expect(await runText('money', { amount: '1,234.50' })).toBe('壹仟贰佰叁拾肆元伍角整')
    expect(await runText('money', { amount: 'abc' })).toContain('Error:')
    expect(await runText('money', { amount: '1.234' })).toContain('Error:')
  })

  it('money handles cents-only and oversized amounts', async () => {
    expect(await runText('money', { amount: '0.01' })).toBe('零元零壹分')
    expect(await runText('money', { amount: '10000000000000000' })).toContain('Error: amount too large')
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

  it('color accepts rgb, hsl and shorthand hex', async () => {
    const tool = TOOL_BY_ID.get('color')!
    const rgb = await tool.run({ value: 'rgb(255, 128, 64)' })
    if (rgb.kind === 'table') {
      const map = new Map(rgb.rows.map(r => [r[0], r[1]]))
      expect(map.get('HEX')).toBe('#FF8040')
    }
    const rgba = await tool.run({ value: 'rgba(255, 128, 64, 0.5)' })
    if (rgba.kind === 'table') {
      const map = new Map(rgba.rows.map(r => [r[0], r[1]]))
      expect(map.get('HEX')).toBe('#FF8040')
    }
    const short = await tool.run({ value: '#f80' })
    if (short.kind === 'table') {
      const map = new Map(short.rows.map(r => [r[0], r[1]]))
      expect(map.get('HEX')).toBe('#FF8800')
    }
    const gray = await tool.run({ value: 'hsl(0, 0%, 50%)' })
    if (gray.kind === 'table') {
      const map = new Map(gray.rows.map(r => [r[0], r[1]]))
      expect(map.get('RGB')).toBe('rgb(128, 128, 128)')
    }
    expect(await runText('color', { value: 'purple' })).toContain('Error:')
  })

  it('unit_convert converts length, weight, temperature and storage', async () => {
    const tool = TOOL_BY_ID.get('unit_convert')!
    const len = await tool.run({ value: '1', from: 'km', to: 'm' })
    expect(len.kind).toBe('table')
    if (len.kind === 'table') expect(len.rows[0]![1]).toBe('1000 m')
    const temp = await tool.run({ value: '100', from: 'c', to: 'f' })
    if (temp.kind === 'table') expect(temp.rows[0]![1]).toBe('212 f')
    const storage = await tool.run({ value: '1', from: 'gib', to: 'mb' })
    if (storage.kind === 'table') expect(storage.rows[0]![1]).toBe('1073.741824 mb')
    const weight = await tool.run({ value: '1', from: 'kg', to: 'jin' })
    if (weight.kind === 'table') expect(weight.rows[0]![1]).toBe('2 jin')
    expect(await runText('unit_convert', { value: '1', from: 'km', to: 'kg' })).toContain('Error: cannot convert length to weight')
    expect(await runText('unit_convert', { value: '1', from: 'furlong', to: 'm' })).toContain('Error: unknown unit')
    expect(await runText('unit_convert', { value: 'abc', from: 'm', to: 'km' })).toContain('Error: value is not a number')
  })

  it('time_convert converts between zones with offsets', async () => {
    const tool = TOOL_BY_ID.get('time_convert')!
    const res = await tool.run({ text: '2026-08-19 10:00:00', from: 'Asia/Shanghai', to: 'UTC' })
    expect(res.kind).toBe('table')
    if (res.kind === 'table') {
      const rows = new Map(res.rows.map(r => [r[0], r[1]]))
      expect(rows.get('UTC')).toBe('2026-08-19 02:00:00')
      expect(String(rows.get('Asia/Shanghai'))).toContain('2026-08-19 10:00:00')
    }
    const bad = await tool.run({ text: '2026-08-19 10:00:00', from: 'Not/AZone', to: 'UTC' })
    expect(bad.kind).toBe('text')
    if (bad.kind === 'text') expect(bad.text).toContain('Error: invalid IANA time zone')
    const garbage = await tool.run({ text: 'hello', from: 'UTC', to: 'UTC' })
    if (garbage.kind === 'text') expect(garbage.text).toContain('Error: expected YYYY-MM-DD HH:mm')
  })
})

describe('reference tools', () => {
  it('http_codes looks up 404', async () => {
    const tool = TOOL_BY_ID.get('http_codes')!
    const result = await tool.run({ code: 404 })
    expect(result.kind).toBe('table')
    if (result.kind === 'table') expect(result.rows[0]![0]).toBe(404)
  })

  it('http_codes lists all and misses unknown codes', async () => {
    const tool = TOOL_BY_ID.get('http_codes')!
    const all = await tool.run({})
    expect(all.kind).toBe('table')
    if (all.kind === 'table') expect(all.rows.length).toBeGreaterThan(20)
    expect(await runText('http_codes', { code: 999 })).toBe('No entry for HTTP 999')
  })

  it('ports looks up 3306', async () => {
    const tool = TOOL_BY_ID.get('ports')!
    const result = await tool.run({ port: 3306 })
    expect(result.kind).toBe('table')
    if (result.kind === 'table') expect(result.rows[0]![1]).toBe('MySQL')
  })

  it('ports misses unknown ports', async () => {
    expect(await runText('ports', { port: 12345 })).toBe('No entry for port 12345')
  })

  it('mime looks up by extension case-insensitively', async () => {
    const tool = TOOL_BY_ID.get('mime')!
    const json = await tool.run({ ext: '.json' })
    expect(json.kind).toBe('table')
    if (json.kind === 'table') expect(json.rows[0]![1]).toBe('application/json')
    const upper = await tool.run({ ext: '.JSON' })
    if (upper.kind === 'table') expect(upper.rows[0]![1]).toBe('application/json')
    const all = await tool.run({})
    if (all.kind === 'table') expect(all.rows.length).toBeGreaterThan(30)
    expect(await runText('mime', { ext: '.zzz' })).toBe('No entry for .zzz')
  })

  it('ascii covers 128 entries', async () => {
    const tool = TOOL_BY_ID.get('ascii')!
    const result = await tool.run({})
    expect(result.kind).toBe('table')
    if (result.kind === 'table') expect(result.rows.length).toBe(128)
  })

  it('ascii looks up one code and rejects out of range', async () => {
    const tool = TOOL_BY_ID.get('ascii')!
    const a = await tool.run({ code: 65 })
    expect(a.kind).toBe('table')
    if (a.kind === 'table') expect(a.rows[0]).toEqual([65, '41', 'A'])
    const nul = await tool.run({ code: 0 })
    if (nul.kind === 'table') expect(nul.rows[0]![2]).toBe('NUL')
    const tab = await tool.run({ code: 9 })
    if (tab.kind === 'table') expect(tab.rows[0]![2]).toBe('TAB')
    const space = await tool.run({ code: 32 })
    if (space.kind === 'table') expect(space.rows[0]![2]).toBe(' ')
    expect(await runText('ascii', { code: 200 })).toContain('Error:')
  })

  it('picker picks from a list', async () => {
    const out = await runText('picker', { text: '甲\n乙\n丙\n丁', count: 2 })
    expect(out.split('\n')).toHaveLength(2)
  })

  it('picker rejects empty lists', async () => {
    expect(await runText('picker', { text: '\n  \n', count: 1 })).toBe('Error: empty list')
  })
})
