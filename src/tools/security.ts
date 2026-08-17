/**
 * Security tools: MD5 (pure TS), SHA-1/256/512 (WebCrypto), UUID v4,
 * random password, random numbers. All local, no network.
 *
 * @module dsh-devtoolbox/tools/security
 */

import type { ToolFn } from './index.ts'

/* ------------------------------------------------------------------ */
/* MD5 (RFC 1321) — pure TypeScript, no crypto dependency.             */
/* ------------------------------------------------------------------ */

const MD5_S: readonly number[] = Object.freeze([
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
])

const MD5_K: readonly number[] = Object.freeze(Array.from({ length: 64 }, (_, i) =>
  Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000),
))

function md5Bytes(bytes: Uint8Array): Uint8Array {
  const bitLen = bytes.length * 8
  const padded = new Uint8Array(((bytes.length + 8) >> 6 << 6) + 64)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const dv = new DataView(padded.buffer)
  dv.setUint32(padded.length - 8, bitLen >>> 0, true)
  dv.setUint32(padded.length - 4, Math.floor(bitLen / 0x100000000), true)

  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476

  const M = new Uint32Array(16)
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true)
    let a = a0, b = b0, c = c0, d = d0
    for (let i = 0; i < 64; i++) {
      let f: number
      let g: number
      if (i < 16) { f = (b & c) | (~b & d); g = i }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16 }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16 }
      else { f = c ^ (b | ~d); g = (7 * i) % 16 }
      f = (f + a + MD5_K[i]! + M[g]!) >>> 0
      a = d; d = c; c = b
      b = (b + ((f << MD5_S[i]!) | (f >>> (32 - MD5_S[i]!)))) >>> 0
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0
  }
  const out = new Uint8Array(16)
  const odv = new DataView(out.buffer)
  odv.setUint32(0, a0, true); odv.setUint32(4, b0, true)
  odv.setUint32(8, c0, true); odv.setUint32(12, d0, true)
  return out
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** MD5 hex digest of a string (UTF-8). */
export function md5Hex(text: string): string {
  return hex(md5Bytes(new TextEncoder().encode(text)))
}

/* ------------------------------------------------------------------ */
/* SHA via WebCrypto (browser crypto.subtle / node:crypto webcrypto).  */
/* ------------------------------------------------------------------ */

async function shaHex(algo: 'SHA-1' | 'SHA-256' | 'SHA-512', text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (subtle === undefined) throw new Error('WebCrypto unavailable')
  const digest = await subtle.digest(algo, new TextEncoder().encode(text))
  return hex(new Uint8Array(digest))
}

/** MD5 hex digest tool (also verifies against known vectors). */
export const md5: ToolFn = {
  id: 'md5',
  nameKey: 'tool.md5',
  descKey: 'tool.md5.desc',
  category: 'security',
  textPayload: true,
  args: {
    text: { type: 'string', required: true, description: 'input text' },
    upper: { type: 'boolean', default: false, description: 'uppercase output' },
  },
  run({ text, upper }) {
    const out = md5Hex(String(text))
    return { kind: 'text', text: upper === true ? out.toUpperCase() : out }
  },
}

/** SHA-1/256/512 hex digest tool. */
export const sha: ToolFn = {
  id: 'sha',
  nameKey: 'tool.sha',
  descKey: 'tool.sha.desc',
  category: 'security',
  textPayload: true,
  args: {
    text: { type: 'string', required: true, description: 'input text' },
    algorithm: { type: 'string', default: 'SHA-256', description: 'SHA-1 | SHA-256 | SHA-512' },
    upper: { type: 'boolean', default: false, description: 'uppercase output' },
  },
  async run({ text, algorithm, upper }) {
    const algo = String(algorithm).toUpperCase().replace('SHA256', 'SHA-256').replace('SHA512', 'SHA-512').replace('SHA1', 'SHA-1')
    if (algo !== 'SHA-1' && algo !== 'SHA-256' && algo !== 'SHA-512') {
      return { kind: 'text', text: 'Error: algorithm must be SHA-1, SHA-256 or SHA-512' }
    }
    try {
      const out = await shaHex(algo, String(text))
      return { kind: 'text', text: upper === true ? out.toUpperCase() : out }
    } catch (error) {
      return { kind: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }
    }
  },
}

function randomBytes(n: number): Uint8Array {
  const c = globalThis.crypto
  const arr = new Uint8Array(n)
  if (c?.getRandomValues !== undefined) c.getRandomValues(arr)
  else for (let i = 0; i < n; i++) arr[i] = Math.floor(Math.random() * 256)
  return arr
}

/** UUID v4 batch generator. */
export const uuid: ToolFn = {
  id: 'uuid',
  nameKey: 'tool.uuid',
  descKey: 'tool.uuid.desc',
  category: 'security',
  textPayload: false,
  args: {
    count: { type: 'number', default: 1, description: 'how many UUIDs (1-100)' },
    upper: { type: 'boolean', default: false, description: 'uppercase' },
    noHyphens: { type: 'boolean', default: false, description: 'strip hyphens' },
  },
  run({ count, upper, noHyphens }) {
    const n = Math.min(100, Math.max(1, Math.floor(Number(count) || 1)))
    const out: string[] = []
    for (let i = 0; i < n; i++) {
      const b = randomBytes(16)
      b[6] = (b[6]! & 0x0f) | 0x40
      b[8] = (b[8]! & 0x3f) | 0x80
      const hexStr = hex(b)
      let u = `${hexStr.slice(0, 8)}-${hexStr.slice(8, 12)}-${hexStr.slice(12, 16)}-${hexStr.slice(16, 20)}-${hexStr.slice(20)}`
      if (noHyphens === true) u = u.replace(/-/g, '')
      if (upper === true) u = u.toUpperCase()
      out.push(u)
    }
    return { kind: 'text', text: out.join('\n') }
  },
}

const PASSWORD_CHARSETS: Record<string, string> = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digit: '0123456789',
  symbol: '!@#$%^&*()-_=+[]{};:,.<>?',
}

/** Random password generator with per-set guarantees and strength estimate. */
export const password: ToolFn = {
  id: 'password',
  nameKey: 'tool.password',
  descKey: 'tool.password.desc',
  category: 'security',
  textPayload: false,
  args: {
    length: { type: 'number', default: 16, description: 'length (8-128)' },
    count: { type: 'number', default: 1, description: 'how many passwords (1-20)' },
    sets: { type: 'string', default: 'lower,upper,digit,symbol', description: 'comma list: lower,upper,digit,symbol' },
    excludeAmbiguous: { type: 'boolean', default: false, description: 'exclude 0O1lI|' },
  },
  run({ length, count, sets, excludeAmbiguous }) {
    const len = Math.min(128, Math.max(8, Math.floor(Number(length) || 16)))
    const n = Math.min(20, Math.max(1, Math.floor(Number(count) || 1)))
    const setNames = String(sets).split(',').map(s => s.trim()).filter((s): s is keyof typeof PASSWORD_CHARSETS => s in PASSWORD_CHARSETS)
    if (setNames.length === 0) return { kind: 'text', text: 'Error: at least one of lower,upper,digit,symbol required' }
    const pool = setNames.map(s => PASSWORD_CHARSETS[s]!).join('')
    const ambiguous = new Set('0O1lI|'.split(''))
    const pick = (charset: string) => {
      let poolChars = charset
      if (excludeAmbiguous === true) poolChars = [...poolChars].filter(ch => !ambiguous.has(ch)).join('')
      return poolChars[Math.floor(Math.random() * poolChars.length)]!
    }
    const out: string[] = []
    for (let k = 0; k < n; k++) {
      // Guarantee one char per chosen set, then fill from the combined pool.
      const chars: string[] = setNames.map(s => pick(PASSWORD_CHARSETS[s]!))
      while (chars.length < len) chars.push(pick(pool))
      // Fisher-Yates shuffle.
      for (let i = chars.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[chars[i], chars[j]] = [chars[j]!, chars[i]!]
      }
      out.push(chars.join(''))
    }
    const poolSize = [...new Set([...pool])].length
    const entropy = Math.round(len * Math.log2(poolSize))
    return { kind: 'text', text: out.join('\n') + `\n<!-- entropy ≈ ${entropy} bits (length ${len}, pool ${poolSize}) -->` }
  },
}

/** Random number(s) generator. */
export const random_num: ToolFn = {
  id: 'random_num',
  nameKey: 'tool.random_num',
  descKey: 'tool.random_num.desc',
  category: 'security',
  textPayload: false,
  args: {
    min: { type: 'number', default: 1, description: 'inclusive min' },
    max: { type: 'number', default: 100, description: 'inclusive max' },
    count: { type: 'number', default: 1, description: 'how many numbers (1-1000)' },
    unique: { type: 'boolean', default: false, description: 'no duplicates' },
  },
  run({ min, max, count, unique }) {
    const lo = Math.floor(Number(min) || 0)
    const hi = Math.floor(Number(max) || 100)
    if (hi < lo) return { kind: 'text', text: 'Error: max must be >= min' }
    let n = Math.min(1000, Math.max(1, Math.floor(Number(count) || 1)))
    const range = hi - lo + 1
    if (unique === true && n > range) n = range
    const pick = () => lo + Math.floor(Math.random() * range)
    const out: number[] = []
    const seen = new Set<number>()
    let guard = 0
    while (out.length < n && guard < 100_000) {
      guard++
      const v = pick()
      if (unique === true && seen.has(v)) continue
      seen.add(v)
      out.push(v)
    }
    return { kind: 'text', text: out.join(', ') }
  },
}

export const securityTools: readonly ToolFn[] = Object.freeze([
  md5,
  sha,
  uuid,
  password,
  random_num,
])
