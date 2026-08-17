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

export const convertTools: readonly ToolFn[] = Object.freeze([
  money,
  color,
])
