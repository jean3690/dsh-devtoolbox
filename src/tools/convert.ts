/**
 * Convert tools: RMB uppercase amount, color (HEX/RGB/HSL) conversion.
 *
 * @module dsh-devtoolbox/tools/convert
 */

import type { ToolFn } from './index.ts'

const CN_DIGITS = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'] as const
const CN_UNITS = ['', '拾', '佰', '仟'] as const
const CN_GROUPS = ['', '万', '亿', '万亿'] as const

function integerPart(n: bigint): string {
  if (n === 0n) return '零'
  const groups: string[] = []
  let v = n
  let g = 0
  while (v > 0n) {
    const chunk = Number(v % 10000n)
    v /= 10000n
    if (chunk === 0) {
      groups.push('')
    } else {
      let s = ''
      let zeroPending = false
      for (let i = 3; i >= 0; i--) {
        const digit = Math.floor(chunk / 10 ** i) % 10
        if (digit === 0) {
          if (s !== '') zeroPending = true
        } else {
          if (zeroPending) s += '零'
          s += CN_DIGITS[digit]! + CN_UNITS[i]!
          zeroPending = false
        }
      }
      groups.push(s + (g > 0 ? (CN_GROUPS[g] ?? '') : ''))
    }
    g++
  }
  const joined = groups.reverse().join('')
  return joined.replace(/零+$/, '') || '零'
}

/** RMB amount → standard Chinese uppercase (财务大写). */
export const money: ToolFn = {
  id: 'money',
  nameKey: 'tool.money',
  descKey: 'tool.money.desc',
  category: 'convert',
  textPayload: false,
  args: {
    amount: { type: 'string', required: true, description: 'amount, e.g. 1234.56' },
  },
  run({ amount }) {
    const s = String(amount).trim().replace(/,/g, '')
    if (!/^-?\d+(\.\d{1,2})?$/.test(s)) {
      return { kind: 'text', text: 'Error: invalid amount (up to 2 decimal places)' }
    }
    const negative = s.startsWith('-')
    const [intStr, decStr = ''] = s.replace(/^-/, '').split('.')
    const int = BigInt(intStr === undefined || intStr === '' ? '0' : intStr)
    if (int > 9999999999999999n) return { kind: 'text', text: 'Error: amount too large' }
    let out = negative ? '负' : ''
    if (int === 0n && (decStr === '' || /^0*$/.test(decStr))) {
      out += '零元整'
      return { kind: 'text', text: out }
    }
    const jiao = decStr[0] ? Number(decStr[0]) : 0
    const fen = decStr[1] ? Number(decStr[1]) : 0
    if (int > 0n) {
      out += integerPart(int) + '元'
      if (jiao === 0 && fen === 0) out += '整'
    } else {
      out += '零元'
    }
    if (jiao > 0) out += CN_DIGITS[jiao]! + '角'
    else if (fen > 0) out += '零'
    if (fen > 0) out += CN_DIGITS[fen]! + '分'
    else if (jiao > 0) out += '整'
    return { kind: 'text', text: out }
  },
}

/* ------------------------------------------------------------------ */
/* Color conversion.                                                   */
/* ------------------------------------------------------------------ */

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, Math.round(l * 100)]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60
  else if (max === gn) h = ((bn - rn) / d + 2) * 60
  else h = ((rn - gn) / d + 4) * 60
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hn = ((h % 360) + 360) % 360 / 360
  const sn = Math.max(0, Math.min(1, s / 100))
  const ln = Math.max(0, Math.min(1, l / 100))
  if (sn === 0) return [clamp255(ln * 255), clamp255(ln * 255), clamp255(ln * 255)]
  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn
  const p = 2 * ln - q
  const hue = (t: number) => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  return [clamp255(hue(hn + 1 / 3) * 255), clamp255(hue(hn) * 255), clamp255(hue(hn - 1 / 3) * 255)]
}

/** HEX ⇄ RGB ⇄ HSL conversion with a color swatch preview value. */
export const color: ToolFn = {
  id: 'color',
  nameKey: 'tool.color',
  descKey: 'tool.color.desc',
  category: 'convert',
  textPayload: false,
  args: {
    value: { type: 'string', required: true, description: 'HEX (#rgb/#rrggbb), rgb(r,g,b) or hsl(h,s%,l%)' },
  },
  run({ value }) {
    const s = String(value).trim()
    let r = 0, g = 0, b = 0
    const hex = s.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
    const rgb = s.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/)
    const hsl = s.match(/^hsla?\(\s*(\d{1,3}(?:\.\d+)?)\s*,\s*(\d{1,3}(?:\.\d+)?)%\s*,\s*(\d{1,3}(?:\.\d+)?)%/)
    if (hex !== null) {
      const h = hex[1]!
      const full = h.length === 3 ? [...h].map(c => c + c).join('') : h
      r = parseInt(full.slice(0, 2), 16)
      g = parseInt(full.slice(2, 4), 16)
      b = parseInt(full.slice(4, 6), 16)
    } else if (rgb !== null) {
      r = clamp255(Number(rgb[1]))
      g = clamp255(Number(rgb[2]))
      b = clamp255(Number(rgb[3]))
    } else if (hsl !== null) {
      ;[r, g, b] = hslToRgb(Number(hsl[1]), Number(hsl[2]), Number(hsl[3]))
    } else {
      return { kind: 'text', text: 'Error: expected HEX, rgb(r,g,b) or hsl(h,s%,l%)' }
    }
    const [h, s2, l] = rgbToHsl(r, g, b)
    const hexOut = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
    return {
      kind: 'table',
      columns: ['format', 'value'],
      rows: [
        ['HEX', hexOut.toUpperCase()],
        ['RGB', `rgb(${r}, ${g}, ${b})`],
        ['HSL', `hsl(${h}, ${s2}%, ${l}%)`],
      ],
      note: hexOut,
    }
  },
}

/** Unit conversion: length / weight / temperature / storage. */
const UNITS: Record<string, { cat: string; toBase: (v: number) => number; fromBase: (v: number) => number }> = {
  // length → meter
  m: { cat: 'length', toBase: v => v, fromBase: v => v },
  km: { cat: 'length', toBase: v => v * 1000, fromBase: v => v / 1000 },
  cm: { cat: 'length', toBase: v => v / 100, fromBase: v => v * 100 },
  mm: { cat: 'length', toBase: v => v / 1000, fromBase: v => v * 1000 },
  in: { cat: 'length', toBase: v => v * 0.0254, fromBase: v => v / 0.0254 },
  ft: { cat: 'length', toBase: v => v * 0.3048, fromBase: v => v / 0.3048 },
  yd: { cat: 'length', toBase: v => v * 0.9144, fromBase: v => v / 0.9144 },
  mi: { cat: 'length', toBase: v => v * 1609.344, fromBase: v => v / 1609.344 },
  // weight → gram
  g: { cat: 'weight', toBase: v => v, fromBase: v => v },
  kg: { cat: 'weight', toBase: v => v * 1000, fromBase: v => v / 1000 },
  t: { cat: 'weight', toBase: v => v * 1e6, fromBase: v => v / 1e6 },
  mg: { cat: 'weight', toBase: v => v / 1000, fromBase: v => v * 1000 },
  lb: { cat: 'weight', toBase: v => v * 453.59237, fromBase: v => v / 453.59237 },
  oz: { cat: 'weight', toBase: v => v * 28.349523125, fromBase: v => v / 28.349523125 },
  jin: { cat: 'weight', toBase: v => v * 500, fromBase: v => v / 500 },
  // temperature → celsius
  c: { cat: 'temp', toBase: v => v, fromBase: v => v },
  f: { cat: 'temp', toBase: v => (v - 32) * 5 / 9, fromBase: v => v * 9 / 5 + 32 },
  k: { cat: 'temp', toBase: v => v - 273.15, fromBase: v => v + 273.15 },
  // storage → byte (decimal)
  b: { cat: 'storage', toBase: v => v, fromBase: v => v },
  kb: { cat: 'storage', toBase: v => v * 1000, fromBase: v => v / 1000 },
  mb: { cat: 'storage', toBase: v => v * 1e6, fromBase: v => v / 1e6 },
  gb: { cat: 'storage', toBase: v => v * 1e9, fromBase: v => v / 1e9 },
  tb: { cat: 'storage', toBase: v => v * 1e12, fromBase: v => v / 1e12 },
  kib: { cat: 'storage', toBase: v => v * 1024, fromBase: v => v / 1024 },
  mib: { cat: 'storage', toBase: v => v * 1048576, fromBase: v => v / 1048576 },
  gib: { cat: 'storage', toBase: v => v * 1073741824, fromBase: v => v / 1073741824 },
  tib: { cat: 'storage', toBase: v => v * 1099511627776, fromBase: v => v / 1099511627776 },
}

function fmtNum(v: number): string {
  if (Number.isNaN(v) || !Number.isFinite(v)) return 'Error: invalid number'
  return String(Math.round(v * 1e10) / 1e10)
}

export const unit_convert: ToolFn = {
  id: 'unit_convert',
  nameKey: 'tool.unit_convert',
  descKey: 'tool.unit_convert.desc',
  category: 'convert',
  args: {
    value: { type: 'string', required: true, description: 'value, e.g. 1000' },
    from: { type: 'string', required: true, description: 'source unit, e.g. kb' },
    to: { type: 'string', required: true, description: 'target unit, e.g. mb' },
  },
  run({ value, from, to }) {
    const f = String(from).toLowerCase().trim()
    const t = String(to).toLowerCase().trim()
    const src = UNITS[f]
    const dst = UNITS[t]
    if (src === undefined || dst === undefined) {
      const known = Object.keys(UNITS).join(' ')
      const bad = src === undefined ? f : t
      return { kind: 'text', text: `Error: unknown unit "${bad}" (known: ${known})` }
    }
    if (src.cat !== dst.cat) return { kind: 'text', text: `Error: cannot convert ${src.cat} to ${dst.cat}` }
    const v = Number(String(value).trim().replace(/,/g, ''))
    if (!Number.isFinite(v)) return { kind: 'text', text: 'Error: value is not a number' }
    const out = fmtNum(dst.fromBase(src.toBase(v)))
    if (out.startsWith('Error')) return { kind: 'text', text: out }
    return { kind: 'table', columns: ['from', 'to', 'value'], rows: [[`${value} ${f}`, `${out} ${t}`, `${src.cat}`]] }
  },
}

/* ------------------------------------------------------------------ */
/* time_convert: convert wall-clock time between IANA time zones.      */
/* ------------------------------------------------------------------ */

const TZ_CACHE = new Map<string, Intl.DateTimeFormat>()

function tzFormat(tz: string): Intl.DateTimeFormat {
  let fmt = TZ_CACHE.get(tz)
  if (fmt === undefined) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    TZ_CACHE.set(tz, fmt)
  }
  return fmt
}

/** Offset (ms) of `tz` at `date`, by formatting and re-parsing. */
function tzOffsetMs(date: Date, tz: string): number {
  const parts: Record<string, string> = {}
  for (const p of tzFormat(tz).formatToParts(date)) parts[p.type] = p.value
  const asUtc = Date.UTC(Number(parts['year']), Number(parts['month']) - 1, Number(parts['day']), Number(parts['hour']), Number(parts['minute']), Number(parts['second']))
  return asUtc - date.getTime()
}

function parseWallClock(input: string): { ok: true; fields: [number, number, number, number, number, number] } | { ok: false; error: string } {
  const m = input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (m === null) return { ok: false, error: 'expected YYYY-MM-DD HH:mm[:ss]' }
  const fields = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0)] as [number, number, number, number, number, number]
  if (fields[0]! < 1970 || fields[1]! < 1 || fields[1]! > 12 || fields[2]! < 1 || fields[2]! > 31 || fields[3]! > 23 || fields[4]! > 59 || fields[5]! > 59) {
    return { ok: false, error: 'fields out of range' }
  }
  return { ok: true, fields }
}

export const time_convert: ToolFn = {
  id: 'time_convert',
  nameKey: 'tool.time_convert',
  descKey: 'tool.time_convert.desc',
  category: 'convert',
  args: {
    text: { type: 'string', required: true, description: 'wall-clock time, e.g. 2026-08-19 10:00:00' },
    from: { type: 'string', default: 'Asia/Shanghai', description: 'source IANA time zone' },
    to: { type: 'string', default: 'UTC', description: 'target IANA time zone' },
  },
  run({ text, from, to }) {
    const f = String(from).trim()
    const t = String(to).trim()
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: f }).format()
      new Intl.DateTimeFormat('en-US', { timeZone: t }).format()
    } catch {
      return { kind: 'text', text: 'Error: invalid IANA time zone' }
    }
    const parsed = parseWallClock(String(text).trim())
    if (!parsed.ok) return { kind: 'text', text: `Error: ${parsed.error}` }
    const [y, mo, d, h, mi, s] = parsed.fields
    let guess = Date.UTC(y, mo - 1, d, h, mi, s)
    const off1 = tzOffsetMs(new Date(guess), f)
    let adjusted = guess - off1
    const off2 = tzOffsetMs(new Date(adjusted), f)
    if (off2 !== off1) adjusted = guess - off2
    const utc = new Date(adjusted)
    const parts: Record<string, string> = {}
    for (const p of tzFormat(t).formatToParts(utc)) parts[p.type] = p.value
    const pad = (n: string): string => n.length === 1 ? `0${n}` : n
    const out = `${parts['year']}-${pad(parts['month']!)}-${pad(parts['day']!)} ${pad(parts['hour']!)}:${pad(parts['minute']!)}:${pad(parts['second']!)}`
    const offMs = tzOffsetMs(utc, t)
    const offStr = `${offMs < 0 ? '-' : '+'}${Math.abs(Math.floor(offMs / 3600000)).toString().padStart(2, '0')}:${String(Math.abs(Math.round(offMs % 3600000 / 60000))).padStart(2, '0')}`
    return { kind: 'table', columns: ['zone', 'time', 'offset'], rows: [[f, `${String(text).trim()}`, off1 === off2 ? '' : `DST boundary (${offStr})`], [t, out, `UTC${offStr}`]] }
  },
}

export const convertTools: readonly ToolFn[] = Object.freeze([
  money,
  color,
  unit_convert,
  time_convert,
])
