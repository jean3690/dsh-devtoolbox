/**
 * Data tools: JSON format/validate, JSON⇄CSV, CSV encoding repair, line diff.
 *
 * @module dsh-devtoolbox/tools/data
 */

import type { ToolFn } from './index.ts'

function parseJson(text: string): unknown {
  return JSON.parse(text)
}

/** JSON format / minify / validate. */
export const json_format: ToolFn = {
  id: 'json_format',
  nameKey: 'tool.json_format',
  descKey: 'tool.json_format.desc',
  category: 'data',
  textPayload: true,
  args: {
    text: { type: 'string', required: true, description: 'JSON input' },
    mode: { type: 'string', default: 'format', description: 'format | minify | validate' },
    indent: { type: 'number', default: 2, description: 'indent spaces (format only)' },
  },
  run({ text, mode, indent }) {
    const s = String(text)
    let parsed: unknown
    try {
      parsed = parseJson(s)
    } catch (error) {
      return { kind: 'text', text: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}` }
    }
    if (mode === 'validate') return { kind: 'text', text: 'Valid JSON ✓' }
    if (mode === 'minify') return { kind: 'text', text: JSON.stringify(parsed) }
    return { kind: 'text', text: JSON.stringify(parsed, null, Math.max(0, Number(indent) || 0)) }
  },
}

function escapeCsv(field: unknown): string {
  const s = String(field ?? '')
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else inQuotes = false
      } else cur += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      out.push(cur); cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

/** JSON array-of-objects ⇄ CSV. */
export const json_csv: ToolFn = {
  id: 'json_csv',
  nameKey: 'tool.json_csv',
  descKey: 'tool.json_csv.desc',
  category: 'data',
  textPayload: true,
  args: {
    text: { type: 'string', required: true, description: 'JSON or CSV input' },
    direction: { type: 'string', default: 'jsonToCsv', description: 'jsonToCsv | csvToJson' },
    delimiter: { type: 'string', default: ',', description: 'CSV delimiter' },
  },
  run({ text, direction, delimiter }) {
    const s = String(text)
    const delim = String(delimiter || ',')
    try {
      if (direction === 'csvToJson') {
        const lines = s.split(/\r\n|\r|\n/).filter(l => l.trim() !== '')
        if (lines.length === 0) return { kind: 'text', text: 'Error: empty CSV' }
        const headers = parseCsvLine(lines[0]!).map(h => h.trim())
        const rows = lines.slice(1).map(line => {
          const cells = parseCsvLine(line)
          const obj: Record<string, string> = {}
          headers.forEach((h, i) => { obj[h] = cells[i] ?? '' })
          return obj
        })
        return { kind: 'json', json: rows }
      }
      const parsed = parseJson(s)
      if (!Array.isArray(parsed)) return { kind: 'text', text: 'Error: JSON must be an array of objects' }
      if (parsed.length === 0) return { kind: 'text', text: 'Error: empty array' }
      const headers = [...new Set(parsed.flatMap(row =>
        (row !== null && typeof row === 'object') ? Object.keys(row as object) : [],
      ))]
      const lines = [
        headers.map(escapeCsv).join(delim),
        ...parsed.map(row => headers.map(h => {
          const v = (row as Record<string, unknown> | null)?.[h]
          return escapeCsv(typeof v === 'object' ? JSON.stringify(v) : v)
        }).join(delim)),
      ]
      return { kind: 'text', text: lines.join('\n') }
    } catch (error) {
      return { kind: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }
    }
  },
}

/** Repair mojibake CSV: decode GBK bytes shown as Latin-1, re-encode UTF-8. */
export const csv_fix: ToolFn = {
  id: 'csv_fix',
  nameKey: 'tool.csv_fix',
  descKey: 'tool.csv_fix.desc',
  category: 'data',
  textPayload: true,
  args: {
    text: { type: 'string', required: true, description: 'mojibake text (e.g. æ°´å¹³)"' },
    direction: { type: 'string', default: 'auto', description: 'auto | utf8ToGbk | gbkToUtf8' },
  },
  run({ text, direction }) {
    const s = String(text)
    try {
      // utf8ToGbk: encode UTF-8 bytes, decode as GBK (produces mojibake-like text).
      if (direction === 'utf8ToGbk') {
        const bytes = new TextEncoder().encode(s)
        return { kind: 'text', text: new TextDecoder('gbk').decode(bytes) }
      }
      // gbkToUtf8: reverse — encode current (Latin-1-view) text back to bytes,
      // decode as UTF-8. Also try the direct Latin-1→UTF-8 path.
      const attempts: string[] = []
      try {
        const asLatin1 = Uint8Array.from([...s].map(ch => ch.charCodeAt(0) & 0xff))
        attempts.push(new TextDecoder('utf-8', { fatal: true }).decode(asLatin1))
      } catch { /* not latin-1 view */ }
      try {
        const bytes = new TextEncoder().encode(s)
        attempts.push(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
      } catch { /* already utf-8 */ }
      return { kind: 'text', text: attempts[0] ?? s }
    } catch (error) {
      return { kind: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }
    }
  },
}

/** Line-level diff via LCS; unified-ish output with + / - / space prefixes. */
export const text_diff: ToolFn = {
  id: 'text_diff',
  nameKey: 'tool.text_diff',
  descKey: 'tool.text_diff.desc',
  category: 'data',
  textPayload: true,
  args: {
    text: { type: 'string', required: true, description: 'original text' },
    other: { type: 'string', required: true, description: 'changed text' },
    context: { type: 'number', default: 2, description: 'context lines' },
  },
  run({ text, other, context }) {
    const a = String(text).split(/\r\n|\r|\n/)
    const b = String(other).split(/\r\n|\r|\n/)
    const n = a.length
    const m = b.length
    // LCS DP (band-limited for pathological inputs).
    const dp: Uint32Array[] = new Array(n + 1)
    for (let i = 0; i <= n; i++) {
      dp[i] = new Uint32Array(m + 1)
    }
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
      }
    }
    const ops: Array<{ op: '+' | '-' | ' '; line: string }> = []
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (a[i] === b[j]) { ops.push({ op: ' ', line: a[i]! }); i++; j++ }
      else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) { ops.push({ op: '-', line: a[i]! }); i++ }
      else { ops.push({ op: '+', line: b[j]! }); j++ }
    }
    while (i < n) { ops.push({ op: '-', line: a[i]! }); i++ }
    while (j < m) { ops.push({ op: '+', line: b[j]! }); j++ }
    // Context folding.
    const ctx = Math.max(0, Number(context) || 0)
    const out: string[] = []
    let skip = 0
    for (let k = 0; k < ops.length; k++) {
      const op = ops[k]!
      if (op.op === ' ') {
        if (skip > 0) { out.push(`@@ -${k - skip},${skip} +${k - skip},${skip} @@`); skip = 0 }
        out.push(` ${op.line}`)
      } else {
        if (skip > ctx && k + ctx < ops.length && ops[k + ctx]!.op === ' ') {
          // too far from a change and from the next one: fold
          const nextChange = ops.slice(k).findIndex(o => o.op !== ' ')
          if (nextChange === -1 || nextChange > 2 * ctx) { out.push('…'); k = k + ctx; continue }
        }
        skip++
        out.push(`${op.op}${op.line}`)
      }
    }
    return { kind: 'text', text: out.join('\n') }
  },
}

export const dataTools: readonly ToolFn[] = Object.freeze([
  json_format,
  json_csv,
  csv_fix,
  text_diff,
])
