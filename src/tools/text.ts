/**
 * Text tools: statistics, cleaning, case/name conversion, CJK conversion.
 * All pure functions — no DOM, no fs, no network.
 *
 * @module dsh-toolbox/tools/text
 */

import type { ToolFn } from './index.ts'
import { Converter } from 'opencc-js'

/** Count characters, CJK chars, words, lines, sentences, paragraphs. */
export const text_stats: ToolFn = {
  id: 'text_stats',
  nameKey: 'tool.text_stats',
  descKey: 'tool.text_stats.desc',
  category: 'text',
  textPayload: true,
  args: { text: { type: 'string', required: true, description: 'input text' } },
  run({ text }) {
    const s = String(text)
    const chars = [...s].length
    const cjk = (s.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) ?? []).length
    const words = (s.trim() === '' ? 0 : s.trim().split(/\s+/).length)
    const lines = s === '' ? 0 : s.split(/\r\n|\r|\n/).length
    const sentences = (s.match(/[^.!?。！？]+[.!?。！？]+/g) ?? []).length
    const paragraphs = s.split(/\r\n|\r|\n/).filter(p => p.trim() !== '').length
    const bytes = new TextEncoder().encode(s).length
    return {
      kind: 'table',
      columns: ['metric', 'value'],
      rows: [
        ['characters', chars],
        ['cjkCharacters', cjk],
        ['words', words],
        ['lines', lines],
        ['sentences', sentences],
        ['paragraphs', paragraphs],
        ['utf8Bytes', bytes],
      ],
    }
  },
}

/** Remove blank lines and trim trailing whitespace per line. */
export const text_remove_blank: ToolFn = {
  id: 'text_remove_blank',
  nameKey: 'tool.text_remove_blank',
  descKey: 'tool.text_remove_blank.desc',
  category: 'text',
  textPayload: true,
  args: {
    text: { type: 'string', required: true, description: 'input text' },
    trim: { type: 'boolean', default: true, description: 'trim each line' },
  },
  run({ text, trim }) {
    const lines = String(text).split(/\r\n|\r|\n/)
    const out = lines
      .map(l => (trim === false ? l : l.trimEnd()))
      .filter(l => l.trim() !== '')
    return { kind: 'text', text: out.join('\n') }
  },
}

/** Deduplicate lines, preserving first occurrence order. */
export const text_dedup: ToolFn = {
  id: 'text_dedup',
  nameKey: 'tool.text_dedup',
  descKey: 'tool.text_dedup.desc',
  category: 'text',
  textPayload: true,
  args: {
    text: { type: 'string', required: true, description: 'input text' },
    ignoreCase: { type: 'boolean', default: false, description: 'case-insensitive' },
  },
  run({ text, ignoreCase }) {
    const seen = new Set<string>()
    const out: string[] = []
    let removed = 0
    for (const line of String(text).split(/\r\n|\r|\n/)) {
      const key = ignoreCase === true ? line.toLocaleLowerCase() : line
      if (seen.has(key)) { removed += 1; continue }
      seen.add(key)
      out.push(line)
    }
    return { kind: 'text', text: out.join('\n') + (removed > 0 ? `\n<!-- removed ${removed} duplicate line(s) -->` : '') }
  },
}

/** Upper/lower/title/sentence case conversion. */
export const case_change: ToolFn = {
  id: 'case_change',
  nameKey: 'tool.case_change',
  descKey: 'tool.case_change.desc',
  category: 'text',
  textPayload: true,
  args: {
    text: { type: 'string', required: true, description: 'input text' },
    style: { type: 'string', default: 'upper', description: 'upper | lower | title | sentence' },
  },
  run({ text, style }) {
    const s = String(text)
    switch (style) {
      case 'lower':
        return { kind: 'text', text: s.toLocaleLowerCase() }
      case 'title':
        return { kind: 'text', text: s.replace(/\b\p{L}/gu, ch => ch.toLocaleUpperCase()) }
      case 'sentence':
        return { kind: 'text', text: s.replace(/(^\s*|(?<=[.!?。！？]\s+))\p{L}/gu, ch => ch.toLocaleUpperCase()) }
      case 'upper':
      default:
        return { kind: 'text', text: s.toLocaleUpperCase() }
    }
  },
}

/** Convert between snake_case / camelCase / PascalCase / kebab-case / CONSTANT_CASE. */
export const case_convert: ToolFn = {
  id: 'case_convert',
  nameKey: 'tool.case_convert',
  descKey: 'tool.case_convert.desc',
  category: 'text',
  textPayload: true,
  args: {
    text: { type: 'string', required: true, description: 'input identifier(s), space/comma/newline separated' },
    to: { type: 'string', default: 'camel', description: 'snake | camel | pascal | kebab | constant' },
  },
  run({ text, to }) {
    // Split any input style into words: separators, case boundaries, digits.
    const words = String(text)
      .split(/[\s,_\-./\\]+/)
      .flatMap(part => part
        .replace(/([a-z\d])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .toLocaleLowerCase()
        .split(' '))
      .filter(w => w !== '')
    const join = (sep: string, cap: (w: string, i: number) => string) => words.map(cap).join(sep)
    let out: string
    switch (to) {
      case 'snake':
        out = join('_', w => w)
        break
      case 'pascal':
        out = join('', w => (w[0]?.toLocaleUpperCase() ?? '') + w.slice(1))
        break
      case 'kebab':
        out = join('-', w => w)
        break
      case 'constant':
        out = join('_', w => w.toLocaleUpperCase())
        break
      case 'camel':
      default:
        out = (words[0] ?? '') + join('', (w, i) => i === 0 ? '' : (w[0]?.toLocaleUpperCase() ?? '') + w.slice(1))
        break
    }
    return { kind: 'text', text: out }
  },
}

/** Full-width ⇄ half-width conversion (CJK punctuation & ASCII). */
export const fullwidth: ToolFn = {
  id: 'fullwidth',
  nameKey: 'tool.fullwidth',
  descKey: 'tool.fullwidth.desc',
  category: 'text',
  textPayload: true,
  args: {
    text: { type: 'string', required: true, description: 'input text' },
    direction: { type: 'string', default: 'toHalf', description: 'toHalf | toFull' },
  },
  run({ text, direction }) {
    const s = String(text)
    const toHalf = direction !== 'toFull'
    let out = ''
    for (const ch of s) {
      const code = ch.codePointAt(0)!
      if (toHalf && code === 0x3000) { out += ' '; continue } // ideographic space
      if (toHalf && code >= 0xff01 && code <= 0xff5e) { out += String.fromCharCode(code - 0xfee0); continue }
      if (!toHalf && code === 0x20) { out += '\u3000'; continue }
      if (!toHalf && code >= 0x21 && code <= 0x7e) { out += String.fromCharCode(code + 0xfee0); continue }
      // Common CJK full-width punctuation beyond the ASCII range.
      const map: Record<string, string> = {
        '，': ',', '。': '.', '；': ';', '：': ':', '？': '?', '！': '!',
        '“': '"', '”': '"', '‘': "'", '’': "'", '（': '(', '）': ')',
        '【': '[', '】': ']', '《': '<', '》': '>', '、': ',', '～': '~',
        '—': '-', '　': ' ',
      }
      const rev = Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k]))
      const hit = toHalf ? map[ch] : rev[ch]
      if (hit !== undefined) { out += hit; continue }
      out += ch
    }
    return { kind: 'text', text: out }
  },
}

/** Simplified ⇄ Traditional Chinese conversion (opencc-js, pure JS, local). */
export const cn_convert: ToolFn = {
  id: 'cn_convert',
  nameKey: 'tool.cn_convert',
  descKey: 'tool.cn_convert.desc',
  category: 'text',
  textPayload: true,
  args: {
    text: { type: 'string', required: true, description: 'input Chinese text' },
    direction: { type: 'string', default: 's2t', description: 's2t (simplified→traditional) | t2s' },
  },
  async run({ text, direction }) {
    const convert = direction === 't2s'
      ? Converter({ from: 'tw', to: 'cn' })
      : Converter({ from: 'cn', to: 'tw' })
    return { kind: 'text', text: convert(String(text)) }
  },
}

/** Regex tester: match against text with flags, list matches with positions. */
export const regex: ToolFn = {
  id: 'regex',
  nameKey: 'tool.regex',
  descKey: 'tool.regex.desc',
  category: 'text',
  textPayload: true,
  args: {
    text: { type: 'string', required: true, description: 'input text' },
    pattern: { type: 'string', required: true, description: 'regular expression' },
    flags: { type: 'string', default: 'g', description: 'regex flags (g i m s u)' },
  },
  run({ text, pattern, flags }) {
    const s = String(text)
    let re: RegExp
    try {
      re = new RegExp(String(pattern), String(flags))
    } catch (error) {
      return { kind: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }
    }
    const rows: (string | number)[][] = []
    let m: RegExpExecArray | null
    let count = 0
    const guard = 100_000
    while ((m = re.exec(s)) !== null && count < guard) {
      rows.push([m[0], m.index, m[1] ?? '', m[2] ?? ''])
      count += 1
      if (m[0] === '') re.lastIndex += 1 // zero-width match: avoid infinite loop
      if (!re.global && !re.sticky) break
    }
    if (rows.length === 0) return { kind: 'text', text: 'No match' }
    return {
      kind: 'table',
      columns: ['match', 'index', 'group1', 'group2'],
      rows,
      note: `${rows.length} match(es)`,
    }
  },
}

/** Line operations: reverse order, sort, reverse characters. */
export const text_ops: ToolFn = {
  id: 'text_ops',
  nameKey: 'tool.text_ops',
  descKey: 'tool.text_ops.desc',
  category: 'text',
  textPayload: true,
  args: {
    text: { type: 'string', required: true, description: 'input text' },
    op: { type: 'string', default: 'reverseLines', description: 'reverseLines | sortLines | reverseChars' },
  },
  run({ text, op }) {
    const s = String(text)
    switch (op) {
      case 'sortLines':
        return { kind: 'text', text: s.split(/\r\n|\r|\n/).sort((a, b) => a.localeCompare(b)).join('\n') }
      case 'reverseChars':
        return { kind: 'text', text: [...s].reverse().join('') }
      case 'reverseLines':
      default:
        return { kind: 'text', text: s.split(/\r\n|\r|\n/).reverse().join('\n') }
    }
  },
}

export const textTools: readonly ToolFn[] = Object.freeze([
  text_stats,
  text_remove_blank,
  text_dedup,
  case_change,
  case_convert,
  fullwidth,
  cn_convert,
  regex,
  text_ops,
])
