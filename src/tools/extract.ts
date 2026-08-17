/**
 * Extract tools: phone numbers (CN), emails, URLs, IPs. Batch + dedup +
 * counts; pure regex over the input text.
 *
 * @module dsh-toolbox/tools/extract
 */

import type { ToolFn } from './index.ts'

interface Extraction {
  id: string
  nameKey: string
  descKey: string
  category: 'extract'
  textPayload: true
  args: {
    text: { type: 'string'; required: true; description: string }
    unique: { type: 'boolean'; default: boolean; description: string }
  }
  run(args: { text: unknown; unique?: unknown }): { kind: 'text'; text: string }
}

function collect(text: string, re: RegExp, unique: boolean): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const v = m[0]
    if (unique && seen.has(v)) { re.lastIndex = Math.max(re.lastIndex, m.index + 1); continue }
    seen.add(v)
    found.push(v)
    if (m[0] === '') re.lastIndex += 1
  }
  return found
}

function extractTool(
  id: string,
  nameKey: string,
  descKey: string,
  re: RegExp,
  label: (v: string) => string = v => v,
): ToolFn {
  return {
    id,
    nameKey,
    descKey,
    category: 'extract',
    textPayload: true,
    args: {
      text: { type: 'string', required: true, description: 'input text' },
      unique: { type: 'boolean', default: true, description: 'deduplicate results' },
    },
    run({ text, unique }) {
      const found = collect(String(text), re, unique !== false)
      if (found.length === 0) return { kind: 'text', text: 'No matches' }
      const rows: (string | number)[][] = found.map(v => [v, label(v)])
      return {
        kind: 'table',
        columns: ['value', 'detail'],
        rows,
        note: `${found.length} found`,
      }
    },
  }
}

/** CN mobile phone numbers with carrier detection. */
export const phone = extractTool(
  'phone',
  'tool.phone',
  'tool.phone.desc',
  /(?<!\d)(?:(?:\+?86[- ]?)?1[3-9]\d{9})(?!\d)/g,
  v => {
    const digits = v.replace(/\D/g, '').slice(-11)
    const prefixes: Array<[RegExp, string]> = [
      [/^13[4-9]/, '中国移动'], [/^15[0-2]/, '中国移动'], [/^15[7-9]/, '中国移动'], [/^18[2-8]/, '中国移动'], [/^14[78]/, '中国移动'], [/^19[5-9]/, '中国移动'], [/^17[2-8]/, '中国移动'],
      [/^13[0-2]/, '中国联通'], [/^15[56]/, '中国联通'], [/^18[56]/, '中国联通'], [/^14[56]/, '中国联通'], [/^17[0-1]/, '中国联通'], [/^16[67]/, '中国联通'],
      [/^133/, '中国电信'], [/^153/, '中国电信'], [/^18[019]/, '中国电信'], [/^149/, '中国电信'], [/^17[3-4]/, '中国电信'], [/^199/, '中国电信'], [/^16[2-3]/, '中国电信'], [/^191/, '中国电信'],
    ]
    for (const [re, name] of prefixes) if (re.test(digits)) return name
    return 'unknown carrier'
  },
)

/** Email addresses. */
export const email = extractTool(
  'email',
  'tool.email',
  'tool.email.desc',
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
)

/** URLs with http/https/ftp schemes. */
export const url_extract = extractTool(
  'url_extract',
  'tool.url_extract',
  'tool.url_extract.desc',
  /https?:\/\/[^\s<>"']+|ftp:\/\/[^\s<>"']+/gi,
)

/** IPv4 (and optionally IPv6) addresses. */
export const ip_extract: ToolFn = {
  id: 'ip_extract',
  nameKey: 'tool.ip_extract',
  descKey: 'tool.ip_extract.desc',
  category: 'extract',
  textPayload: true,
  args: {
    text: { type: 'string', required: true, description: 'input text' },
    includeV6: { type: 'boolean', default: true, description: 'include IPv6 addresses' },
    unique: { type: 'boolean', default: true, description: 'deduplicate results' },
  },
  run({ text, includeV6, unique }) {
    const s = String(text)
    const v4 = /(?<!\d)(?:\d{1,3}\.){3}\d{1,3}(?!\d)/g
    const v6 = /(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{0,4}(?:::[0-9a-fA-F]{1,4})?/g
    const v4s = collect(s, v4, unique !== false).filter(ip => ip.split('.').every(p => Number(p) <= 255))
    const v6s = includeV6 !== false ? collect(s, v6, unique !== false) : []
    const rows: (string | number)[][] = [
      ...v4s.map(v => ['IPv4', v] as (string | number)[]),
      ...v6s.map(v => ['IPv6', v] as (string | number)[]),
    ]
    if (rows.length === 0) return { kind: 'text', text: 'No matches' }
    return {
      kind: 'table',
      columns: ['type', 'address'],
      rows,
      note: `${rows.length} found (v4: ${v4s.length}, v6: ${v6s.length})`,
    }
  },
}

export const extractTools: readonly ToolFn[] = Object.freeze([
  phone,
  email,
  url_extract,
  ip_extract,
])
