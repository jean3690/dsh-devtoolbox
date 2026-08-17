/**
 * The toolbox host service: serves the one host capability the browser UI
 * cannot do alone — writing a tool output into the profile's save directory.
 * File names and subdirectories are sanitized (no path traversal), and the
 * service never touches any configuration file.
 *
 * @module dsh-devtoolbox/service
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SaveRequest, SaveResult } from './wire.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Toolbox save service (this package). */
    toolbox: ToolboxService
  }
}

/** Basename characters allowed in saved file names. */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/

/** Subdirectory path characters allowed (segments). */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/** Sanitize a file name: basename only, safe charset, default fallback. */
export function sanitizeFileName(name: string, fallback = 'output.txt'): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  return SAFE_NAME.test(base) ? base : fallback
}

/** Sanitize a subdir path: safe segments joined by the platform separator. */
export function sanitizeSubdir(subdir: string): string {
  const segments = subdir.split(/[\\/]/).filter(s => s !== '' && s !== '.' && s !== '..')
  const clean = segments.filter(s => SAFE_SEGMENT.test(s))
  return clean.join(sep)
}

/**
 * Toolbox save service, exported over the `toolbox` Remote namespace
 * (`toolbox/save`). Writes into `saveDir` (absolute path resolved at load).
 */
export class ToolboxService extends TypertRemoteService {
  static inject = [] as const

  /** Absolute save directory. */
  readonly saveDir: string

  /**
   * @param ctx - cordis context.
   * @param saveDir - absolute directory outputs are written into.
   */
  constructor(ctx: Context, saveDir: string) {
    super(ctx, 'toolbox')
    this.saveDir = saveDir
  }

  /**
   * Write one output file. Sanitizes the name/subdir and reports the
   * absolute path back. Never touches configuration files.
   *
   * @param request - file name, content, optional subdirectory.
   * @returns the written file's absolute path, byte count, and save dir.
   */
  async save(request: SaveRequest): Promise<SaveResult> {
    const fileName = sanitizeFileName(request.fileName)
    const subdir = request.subdir === undefined ? '' : sanitizeSubdir(request.subdir)
    const dir = subdir === '' ? this.saveDir : join(this.saveDir, subdir)
    await mkdir(dir, { recursive: true })
    const target = resolve(dir, fileName)
    // Defense in depth: resolved target must stay under the save dir.
    const root = this.saveDir.endsWith(sep) ? this.saveDir : this.saveDir + sep
    if (target !== this.saveDir && !target.startsWith(root)) {
      throw new Error(`dsh-devtoolbox: refused to write outside the save directory: ${target}`)
    }
    const bytes = Buffer.byteLength(request.content, 'utf8')
    await writeFile(target, request.content, 'utf8')
    return { path: target, bytes, saveDir: this.saveDir }
  }

  /** Resolve the configured save dir against the profile root. */
  static resolveSaveDir(baseUrl: string | undefined, configured: string): string {
    const base = baseUrl === undefined || baseUrl === ''
      ? process.cwd()
      : baseUrl.startsWith('file://') ? fileURLToPath(baseUrl) : baseUrl
    return isAbsolute(configured) ? configured : join(base, configured)
  }
}

export default ToolboxService
