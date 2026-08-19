/**
 * Extract tools: phone numbers (CN), emails, URLs, IPs. Batch + dedup +
 * counts; pure regex over the input text.
 *
 * @module dsh-devtoolbox/tools/extract
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
    // Disjoint 3-digit prefix segments; order doesn't matter.
    const prefixes: Array<[RegExp, string]> = [
      // 中国移动
      [/^13[4-9]/, '中国移动'], [/^147/, '中国移动'], [/^15[0-2]/, '中国移动'], [/^15[7-9]/, '中国移动'],
      [/^165/, '中国移动'], [/^172/, '中国移动'], [/^17[89]/, '中国移动'], [/^18[2-4]/, '中国移动'],
      [/^18[78]/, '中国移动'], [/^19[578]/, '中国移动'],
      // 中国联通
      [/^13[0-2]/, '中国联通'], [/^145/, '中国联通'], [/^146/, '中国联通'], [/^155/, '中国联通'], [/^156/, '中国联通'],
      [/^16[67]/, '中国联通'], [/^170/, '中国联通'], [/^171/, '中国联通'], [/^17[56]/, '中国联通'], [/^18[56]/, '中国联通'],
      [/^196/, '中国联通'],
      // 中国电信
      [/^133/, '中国电信'], [/^149/, '中国电信'], [/^153/, '中国电信'], [/^16[0-3]/, '中国电信'],
      [/^17[34]/, '中国电信'], [/^177/, '中国电信'], [/^18[01]/, '中国电信'], [/^189/, '中国电信'],
      [/^19[013]/, '中国电信'], [/^199/, '中国电信'],
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

/** Chinese resident ID number: validate checksum, extract birthdate/sex. */
const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
const ID_CHECK = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']

export function parseIdCard(id: string): { ok: true; id18: string; born: string; sex: string; region: string; valid: boolean; from15: boolean } | { ok: false; error: string } {
  let s = id.trim().toUpperCase()
  let from15 = false
  if (/^\d{15}$/.test(s)) {
    // 15 → 18: insert "19" at the year position and recompute the checksum.
    s = s.slice(0, 6) + '19' + s.slice(6)
    from15 = true
  }
  if (!(from15 ? /^\d{17}$/.test(s) : /^\d{17}[\dX]$/.test(s))) return { ok: false, error: 'not a valid 15/18-digit ID number' }
  let sum = 0
  for (let i = 0; i < 17; i++) sum += ID_WEIGHTS[i]! * Number(s[i])
  const check = ID_CHECK[sum % 11]!
  if (from15) s += check
  return {
    ok: true,
    id18: s,
    valid: from15 ? true : check === s[17],
    born: `${s.slice(6, 10)}-${s.slice(10, 12)}-${s.slice(12, 14)}`,
    sex: Number(s[16]) % 2 === 1 ? 'male' : 'female',
    region: s.slice(0, 6),
    from15,
  }
}

export const id_card: ToolFn = {
  id: 'id_card',
  nameKey: 'tool.id_card',
  descKey: 'tool.id_card.desc',
  category: 'extract',
  textPayload: true,
  args: {
    text: { type: 'string', required: true, description: '15 or 18 digit ID number (one per line)' },
  },
  run({ text }) {
    const lines = String(text).split(/\r\n|\r|\n/).map(l => l.trim()).filter(l => l !== '')
    if (lines.length === 0) return { kind: 'text', text: 'Error: empty input' }
    const rows: Array<readonly (string | number)[]> = []
    const notes: string[] = []
    for (const line of lines) {
      const res = parseIdCard(line)
      if (!res.ok) { notes.push(`"${line}": ${res.error}`); continue }
      rows.push([res.id18, res.valid ? '✓' : '✗', res.born, res.sex, res.region, res.from15 ? 'from 15-digit' : '18-digit'])
      if (!res.valid) notes.push(`"${line}": checksum mismatch`)
    }
    return {
      kind: 'table',
      columns: ['id', 'valid', 'birthdate', 'sex', 'region code', 'length'],
      rows,
      note: notes.length > 0 ? notes.join('; ') : undefined,
    }
  },
}

export const extractTools: readonly ToolFn[] = Object.freeze([
  phone,
  email,
  url_extract,
  ip_extract,
  id_card,
])
