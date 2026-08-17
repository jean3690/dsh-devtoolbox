/**
 * Host-only toolbox tools: file hashing and file encoding conversion.
 * These need the filesystem, so they exist only in the host half (agent
 * tools + /toolbox commands), never in the browser UI — the browser offers
 * file-hash/encoding via the File API instead.
 *
 * Relative paths resolve against the profile root (ctx.baseUrl).
 *
 * @module dsh-devtoolbox/hostTools
 */

import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** Resolve a user-supplied path against the profile root. */
function resolvePath(baseUrl: string | undefined, p: string): string {
  return isAbsolute(p) ? p : join(baseUrl ?? process.cwd(), p)
}

/** Coerce a maybe-undefined arg to a string (or a fallback). */
function strArg(v: unknown, fallback: string): string {
  return typeof v === 'string' && v !== '' ? v : fallback
}

/** Digest algorithms the file-hash tool supports. */
export type HashAlgorithm = 'md5' | 'sha1' | 'sha256'

/**
 * Hash one file (pure; testable without the tool registry).
 * @param abs - absolute file path.
 * @param algo - digest algorithm.
 * @returns the hex digest and byte count.
 */
export async function hashFile(abs: string, algo: HashAlgorithm): Promise<{ hex: string; bytes: number }> {
  const data = await readFile(abs)
  const hex = createHash(algo).update(data).digest('hex')
  return { hex, bytes: data.length }
}

/** `toolbox_file_hash`: MD5/SHA-1/SHA-256 digest of a file. */
export function fileHashTool(baseUrl: string | undefined): ToolDefinition {
  return defineTool({
    name: 'toolbox_file_hash',
    description: 'Compute the MD5, SHA-1 or SHA-256 digest of a file on this machine. '
      + 'Use for integrity checks and dedup. Relative paths resolve against the profile root.',
    parameters: {
      path: { type: 'string', required: true, description: 'absolute or profile-relative file path' },
      algorithm: { type: 'string', description: 'md5 | sha1 | sha256 (default sha256)' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          algorithm: { type: 'string', required: true },
          hex: { type: 'string', required: true },
          bytes: { type: 'number', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `${value.algorithm}: ${value.hex} (${value.bytes} bytes)`,
      }],
    },
    async execute(args) {
      const algo = strArg(args.algorithm, 'sha256') as HashAlgorithm
      if (algo !== 'md5' && algo !== 'sha1' && algo !== 'sha256') {
        throw new Error(`toolbox_file_hash: unsupported algorithm "${algo}" (md5 | sha1 | sha256)`)
      }
      const abs = resolvePath(baseUrl, strArg(args.path, ''))
      const { hex, bytes } = await hashFile(abs, algo)
      return { algorithm: algo, hex, bytes }
    },
  })
}

/** Encoding conversion directions for the file tool. */
export type EncodeDirection = 'gbkToUtf8' | 'utf8ToGbk'

/**
 * Convert one file's text encoding (pure; testable without the tool registry).
 * @param abs - absolute input path.
 * @param direction - conversion direction.
 * @param target - absolute output path (may equal `abs` to overwrite).
 * @returns the written path and byte count.
 */
export async function convertFileEncoding(
  abs: string,
  direction: EncodeDirection,
  target: string,
): Promise<{ path: string; bytes: number }> {
  const data = await readFile(abs)
  let out: Uint8Array
  if (direction === 'utf8ToGbk') {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data)
    out = encodeGbk(text)
  } else {
    const text = decodeGbk(data)
    out = new TextEncoder().encode(text)
  }
  await writeFile(target, out)
  return { path: target, bytes: out.length }
}

/** `toolbox_file_encode`: convert a file's encoding (GBK⇄UTF-8). */
export function fileEncodeTool(baseUrl: string | undefined): ToolDefinition {
  return defineTool({
    name: 'toolbox_file_encode',
    description: 'Convert a text file between GBK and UTF-8 encoding (fixes mojibake, e.g. '
      + 'CSV exported by Excel). Writes either in place or to an output path. '
      + 'Relative paths resolve against the profile root.',
    parameters: {
      path: { type: 'string', required: true, description: 'absolute or profile-relative input file path' },
      direction: { type: 'string', description: 'gbkToUtf8 | utf8ToGbk (default gbkToUtf8)' },
      output: { type: 'string', description: 'optional output path (default: overwrite input)' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          bytes: { type: 'number', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `converted → ${value.path} (${value.bytes} bytes)`,
      }],
    },
    async execute(args) {
      const direction = strArg(args.direction, 'gbkToUtf8') as EncodeDirection
      const abs = resolvePath(baseUrl, strArg(args.path, ''))
      const target = args.output === undefined ? abs : resolvePath(baseUrl, strArg(args.output, ''))
      return convertFileEncoding(abs, direction, target)
    },
  })
}

/**
 * Encode a string as GBK. Uses a per-process codec built from TextDecoder's
 * GBK table: decode every possible byte pair and record the round trip. This
 * is correct for the vast majority of characters; unmappable chars fall back
 * to '?' like iconv's transliteration-off mode.
 */
let gbkEncodeTable: Map<string, number[]> | undefined

function decodeGbk(bytes: Uint8Array): string {
  return new TextDecoder('gbk').decode(bytes)
}

function encodeGbk(text: string): Uint8Array {
  const table = gbkEncodeTable ??= buildGbkTable()
  const out: number[] = []
  for (const ch of text) {
    const mapped = table.get(ch)
    if (mapped !== undefined) {
      out.push(...mapped)
    } else {
      const cp = ch.codePointAt(0)!
      if (cp < 0x80) out.push(cp)
      else out.push(0x3f) // '?'
    }
  }
  return Uint8Array.from(out)
}

function buildGbkTable(): Map<string, number[]> {
  const table = new Map<string, number[]>()
  for (let lead = 0x81; lead <= 0xfe; lead++) {
    for (let trail = 0x40; trail <= 0xfe; trail++) {
      if (trail === 0x7f) continue
      const bytes = Uint8Array.from([lead, trail])
      let text: string
      try {
        text = new TextDecoder('gbk', { fatal: true }).decode(bytes)
      } catch {
        continue
      }
      if (text.length === 1 && !table.has(text)) table.set(text, [lead, trail])
    }
  }
  return table
}
