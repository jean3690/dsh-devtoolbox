/**
 * Encoding tools: base64, URL, HTML entities, unicode escapes, radix,
 * timestamp. Rely only on globals (TextEncoder/TextDecoder, btoa/atob,
 * BigInt) so they run identically in browser and host.
 *
 * @module dsh-devtoolbox/tools/encode
 */

import type { ToolFn, ToolResult } from './index.ts'
import QRCode, { type QRCodeToDataURLOptions } from 'qrcode'

export function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}

export function base64ToUtf8(b64: string): string {
  const bin = atob(b64.trim())
  const bytes = Uint8Array.from(bin, ch => ch.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** URL-safe base64 encode (JWT alphabet, no padding). */
export function base64UrlEncode(s: string): string {
  return utf8ToBase64(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** URL-safe base64 decode → string (or null on malformed input). */
export function base64UrlDecode(s: string): string | null {
  const t = s.replace(/-/g, '+').replace(/_/g, '/')
  try {
    return base64ToUtf8(t)
  } catch {
    return null
  }
}

/** Base64 encode/decode (UTF-8 safe, both directions). */
export const base64: ToolFn = {
  id: 'base64',
  nameKey: 'tool.base64',
  descKey: 'tool.base64.desc',
  category: 'encode',
  textPayload: true,
  args: {
    text: { type: 'string', required: true, description: 'input text or base64 string' },
    direction: { type: 'string', default: 'encode', description: 'encode | decode' },
    urlSafe: { type: 'boolean', default: false, description: 'URL-safe alphabet (-_ instead of +/)' },
  },
  run({ text, direction, urlSafe }) {
    const s = String(text)
    try {
      if (direction === 'decode') {
        let t = s.replace(/\s+/g, '')
        if (urlSafe === true) t = t.replace(/-/g, '+').replace(/_/g, '/')
        return { kind: 'text', text: base64ToUtf8(t) }
      }
      let out = utf8ToBase64(s)
      if (urlSafe === true) out = out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      return { kind: 'text', text: out }
    } catch (error) {
      return { kind: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }
    }
  },
}

/** URL encode/decode + query-string parse/format. */
export const url: ToolFn = {
  id: 'url',
  nameKey: 'tool.url',
  descKey: 'tool.url.desc',
  category: 'encode',
  textPayload: true,
  args: {
    text: { type: 'string', required: true, description: 'URL or query string' },
    direction: { type: 'string', default: 'encode', description: 'encode | decode' },
    mode: { type: 'string', default: 'component', description: 'component | query | full' },
  },
  run({ text, direction, mode }) {
    const s = String(text)
    try {
      if (direction === 'decode') {
        if (mode === 'query') {
          const params = new URLSearchParams(s)
          return {
            kind: 'json',
            json: Object.fromEntries(params.entries()),
          }
        }
        return { kind: 'text', text: decodeURIComponent(s) }
      }
      if (mode === 'query') {
        const params = new URLSearchParams(s)
        return { kind: 'text', text: params.toString() }
      }
      if (mode === 'full') return { kind: 'text', text: encodeURI(s) }
      return { kind: 'text', text: encodeURIComponent(s) }
    } catch (error) {
      return { kind: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }
    }
  },
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}

/** HTML entity escape/unescape. */
export const html_entity: ToolFn = {
  id: 'html_entity',
  nameKey: 'tool.html_entity',
  descKey: 'tool.html_entity.desc',
  category: 'encode',
  textPayload: true,
  args: {
    text: { type: 'string', required: true, description: 'input text or HTML' },
    direction: { type: 'string', default: 'escape', description: 'escape | unescape' },
  },
  run({ text, direction }) {
    const s = String(text)
    if (direction === 'unescape') {
      return {
        kind: 'text',
        text: s
          .replace(/&(amp|lt|gt|quot|#39|#0*39);/g, (_, name: string) => {
            const rev: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#039': "'" }
            return rev[name] ?? '&'
          })
          .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
          .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec))),
      }
    }
    return { kind: 'text', text: s.replace(/[&<>"']/g, ch => HTML_ESCAPES[ch] ?? ch) }
  },
}

/** Unicode \uXXXX / \u{...} escape and unescape. */
export const unicode_escape: ToolFn = {
  id: 'unicode_escape',
  nameKey: 'tool.unicode_escape',
  descKey: 'tool.unicode_escape.desc',
  category: 'encode',
  textPayload: true,
  args: {
    text: { type: 'string', required: true, description: 'input text or escaped text' },
    direction: { type: 'string', default: 'escape', description: 'escape | unescape' },
  },
  run({ text, direction }) {
    const s = String(text)
    if (direction === 'unescape') {
      return {
        kind: 'text',
        text: s
          .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
          .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))),
      }
    }
    let out = ''
    for (const ch of s) {
      const code = ch.codePointAt(0)!
      if (code > 0xffff) out += `\\u{${code.toString(16)}}`
      else if (code < 0x20 || code === 0x7f) out += `\\u${code.toString(16).padStart(4, '0')}`
      else if (/[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]/.test(ch)) out += `\\u${code.toString(16).padStart(4, '0')}`
      else out += ch
    }
    return { kind: 'text', text: out }
  },
}

/** Radix conversion with BigInt (2/8/10/16, arbitrarily large). */
export const radix: ToolFn = {
  id: 'radix',
  nameKey: 'tool.radix',
  descKey: 'tool.radix.desc',
  category: 'encode',
  textPayload: false,
  args: {
    value: { type: 'string', required: true, description: 'the number to convert' },
    from: { type: 'number', default: 10, description: 'source radix (2-36)' },
    to: { type: 'number', default: 16, description: 'target radix (2-36)' },
  },
  run({ value, from, to }) {
    const f = Number(from)
    const t = Number(to)
    if (f < 2 || f > 36 || t < 2 || t > 36) return { kind: 'text', text: 'Error: radix must be 2-36' }
    try {
      const normalized = String(value).trim().toLowerCase().replace(/^0x/, '')
      const prefix = f === 16 ? '0x' : f === 2 ? '0b' : f === 8 ? '0o' : ''
      const big = BigInt(prefix + normalized)
      return { kind: 'text', text: big.toString(t) }
    } catch {
      return { kind: 'text', text: `Error: "${String(value)}" is not a valid base-${f} integer` }
    }
  },
}

/** Timestamp ⇄ date/time conversion. */
export const timestamp: ToolFn = {
  id: 'timestamp',
  nameKey: 'tool.timestamp',
  descKey: 'tool.timestamp.desc',
  category: 'encode',
  textPayload: false,
  args: {
    value: { type: 'string', required: true, description: 'unix timestamp (s or ms) or a date string' },
    from: { type: 'string', default: 'auto', description: 'auto | seconds | millis | date' },
    tz: { type: 'string', default: 'local', description: 'local | utc' },
  },
  run({ value, from, tz }) {
    const v = String(value).trim()
    const utc = tz === 'utc'
    try {
      let ms: number
      if (from === 'date' || /^\d{4}-\d{2}-\d{2}/.test(v)) {
        ms = Date.parse(v)
        if (Number.isNaN(ms)) return { kind: 'text', text: 'Error: invalid date string' }
      } else if (/^\d+$/.test(v)) {
        const n = Number(v)
        ms = from === 'seconds' ? n * 1000 : from === 'millis' ? n : n < 1e12 ? n * 1000 : n
      } else {
        return { kind: 'text', text: 'Error: unrecognized input (use a unix timestamp or a date string)' }
      }
      const d = new Date(ms)
      const fmt = utc
        ? d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')
        : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} `
          + `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
      return {
        kind: 'table',
        columns: ['field', 'value'],
        rows: [
          ['date', fmt],
          ['unixSeconds', Math.floor(ms / 1000)],
          ['unixMillis', ms],
          ['iso', d.toISOString()],
        ],
      }
    } catch {
      return { kind: 'text', text: 'Error: invalid input' }
    }
  },
}

/** Base64 ⇄ data URL, with automatic mime type detection. */
function guessMime(text: string): string {
  if (/^[{\[]/.test(text)) return 'application/json'
  if (/^<(?:\/?[a-zA-Z][^>]*>|\!)/.test(text)) return 'text/html'
  return 'text/plain'
}

export const data_url: ToolFn = {
  id: 'data_url',
  nameKey: 'tool.data_url',
  descKey: 'tool.data_url.desc',
  category: 'encode',
  textPayload: true,
  args: {
    text: { type: 'string', required: true, description: 'text, or a data: URL to decode' },
    mime: { type: 'string', description: 'mime type for encoding (auto-detected by default)' },
    encoding: { type: 'string', default: 'base64', description: 'base64 | plain' },
  },
  run({ text, mime, encoding }) {
    const s = String(text)
    if (/^data:/i.test(s)) {
      const m = s.match(/^data:([^;,]*)?(;base64)?,(.*)$/s)
      if (m === null) return { kind: 'text', text: 'Error: malformed data URL' }
      const type = m[1] === undefined || m[1] === '' ? 'text/plain' : m[1]!
      const isBase64 = m[2] === ';base64'
      const payload = m[3] ?? ''
      const out: Record<string, string> = { mime: type, encoding: isBase64 ? 'base64' : 'plain', payload }
      if (isBase64) {
        try {
          out['text'] = base64ToUtf8(payload)
        } catch {
          // binary payload — keep base64 only
        }
      }
      return { kind: 'json', json: out }
    }
    const type = mime !== undefined && String(mime) !== '' ? String(mime) : guessMime(s)
    if (encoding === 'plain') return { kind: 'text', text: `data:${type},${encodeURIComponent(s)}` }
    return { kind: 'text', text: `data:${type};base64,${utf8ToBase64(s)}` }
  },
}

/** QR code generation (PNG data URL). */
export const qrcode: ToolFn = {
  id: 'qrcode',
  nameKey: 'tool.qrcode',
  descKey: 'tool.qrcode.desc',
  category: 'encode',
  args: {
    text: { type: 'string', required: true, description: 'content to encode' },
    size: { type: 'number', default: 256, description: 'image size in px (16-1024)' },
    margin: { type: 'number', default: 2, description: 'quiet zone modules (0-16)' },
    errorCorrection: { type: 'string', default: 'M', description: 'L | M | Q | H' },
  },
  async run({ text, size, margin, errorCorrection }): Promise<ToolResult> {
    const s = String(text)
    if (s === '') return { kind: 'text', text: 'Error: empty content' }
    const opts: QRCodeToDataURLOptions = {
      width: Math.max(16, Math.min(1024, Math.floor(Number(size)) || 256)),
      margin: Math.max(0, Math.min(16, Math.floor(Number(margin)) || 2)),
      errorCorrectionLevel: ['L', 'M', 'Q', 'H'].includes(String(errorCorrection).toUpperCase()) ? String(errorCorrection).toUpperCase() as 'L' | 'M' | 'Q' | 'H' : 'M',
    }
    try {
      const dataUrl = await QRCode.toDataURL(s, opts)
      return { kind: 'json', json: { dataUrl, bytes: dataUrl.length, content: s.slice(0, 200) } }
    } catch (error) {
      return { kind: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }
    }
  },
}

export const encodeTools: readonly ToolFn[] = Object.freeze([
  base64,
  url,
  html_entity,
  unicode_escape,
  radix,
  timestamp,
  data_url,
  qrcode,
])
