import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { sanitizeFileName, sanitizeSubdir, ToolboxService } from '../src/service.ts'
import { convertFileEncoding, fileEncodeTool, fileHashTool, hashFile } from '../src/hostTools.ts'

const dirs: string[] = []

function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-toolbox-test-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('service sanitization', () => {
  it('sanitizeFileName strips paths and rejects dangerous names', () => {
    expect(sanitizeFileName('report.txt')).toBe('report.txt')
    // Path traversal is neutralized: only the safe basename survives.
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd')
    expect(sanitizeFileName('a\\b\\c.txt')).toBe('c.txt')
    expect(sanitizeFileName('bad name!.txt')).toBe('output.txt')
    expect(sanitizeFileName('')).toBe('output.txt')
    expect(sanitizeFileName('a.txt', 'fallback.txt')).toBe('a.txt')
  })

  it('sanitizeSubdir drops traversal and keeps safe segments', () => {
    expect(sanitizeSubdir('logs/2026')).toBe('logs/2026')
    expect(sanitizeSubdir('../..')).toBe('')
    expect(sanitizeSubdir('a/../../b')).toBe('a/b')
    expect(sanitizeSubdir('')).toBe('')
  })
})

describe('host file tools', () => {
  it('file_hash computes md5/sha256 of a real file', async () => {
    const dir = tmpDir()
    const file = join(dir, 'data.txt')
    writeFileSync(file, 'hello dsh-toolbox', 'utf8')
    const md5 = await hashFile(file, 'md5')
    // Known vector: md5('hello dsh-toolbox')
    expect(md5).toEqual({
      hex: '8e998b264ce99fb1930b30d71bc3ec99',
      bytes: 17,
    })
    const sha = await hashFile(file, 'sha256')
    expect(sha.hex).toHaveLength(64)
    expect(sha.bytes).toBe(17)
  })

  it('file_hash supports sha1', async () => {
    const dir = tmpDir()
    const file = join(dir, 'data.txt')
    writeFileSync(file, 'abc', 'utf8')
    expect(await hashFile(file, 'sha1')).toEqual({
      hex: 'a9993e364706816aba3e25717850c26c9cd0d89d',
      bytes: 3,
    })
  })

  it('file_encode converts GBK to UTF-8 and back', async () => {
    const dir = tmpDir()
    const gbk = join(dir, 'gbk.txt')
    const utf8 = join(dir, 'utf8.txt')
    const backGbk = join(dir, 'back-gbk.txt')
    // '你好' in GBK bytes
    writeFileSync(gbk, Buffer.from([0xc4, 0xe3, 0xba, 0xc3]))
    const out = await convertFileEncoding(gbk, 'gbkToUtf8', utf8)
    expect(out.path).toBe(utf8)
    expect(readFileSync(utf8, 'utf8')).toBe('你好')
    // utf8ToGbk round trip
    const back = await convertFileEncoding(utf8, 'utf8ToGbk', backGbk)
    expect(readFileSync(back.path)).toEqual(Buffer.from([0xc4, 0xe3, 0xba, 0xc3]))
  })

  it('file_encode can overwrite in place', async () => {
    const dir = tmpDir()
    const file = join(dir, 'gbk.txt')
    writeFileSync(file, Buffer.from([0xc4, 0xe3, 0xba, 0xc3]))
    const out = await convertFileEncoding(file, 'gbkToUtf8', file)
    expect(out.path).toBe(file)
    expect(readFileSync(file, 'utf8')).toBe('你好')
  })

  it('file_encode rejects invalid UTF-8 when targeting GBK', async () => {
    const dir = tmpDir()
    const bad = join(dir, 'bad.txt')
    writeFileSync(bad, Buffer.from([0xff, 0xfe, 0x00]))
    await expect(convertFileEncoding(bad, 'utf8ToGbk', join(dir, 'out.txt'))).rejects.toThrow()
  })

  it('file_hash rejects unsupported algorithms and missing files', async () => {
    const dir = tmpDir()
    const file = join(dir, 'a.txt')
    writeFileSync(file, 'abc')
    await expect(fileHashTool(dir).execute({ path: 'a.txt', algorithm: 'md6' }, {} as never))
      .rejects.toThrow(/unsupported algorithm/)
    await expect(hashFile(join(dir, 'nope.txt'), 'md5')).rejects.toThrow()
    await expect(convertFileEncoding(join(dir, 'nope.txt'), 'gbkToUtf8', join(dir, 'x.txt'))).rejects.toThrow()
  })

  it('file_encode writes to an explicit output path', async () => {
    const dir = tmpDir()
    const gbk = join(dir, 'gbk.txt')
    writeFileSync(gbk, Buffer.from([0xc4, 0xe3, 0xba, 0xc3]))
    const result = await fileEncodeTool(dir).execute(
      { path: 'gbk.txt', direction: 'gbkToUtf8', output: 'out.txt' },
      {} as never,
    ) as { path: string; bytes: number }
    expect(result.path).toBe(join(dir, 'out.txt'))
    expect(readFileSync(result.path, 'utf8')).toBe('你好')
  })
})

describe('ToolboxService', () => {
  it('registers under the toolbox key', () => {
    const ctx = new Context()
    const service = new ToolboxService(ctx, '/tmp/saves')
    expect(service.name).toBe('toolbox')
    expect(service.typertRemote.namespace).toBe('toolbox')
  })

  it('save writes a file and reports path/bytes', async () => {
    const dir = tmpDir()
    const ctx = new Context()
    const service = new ToolboxService(ctx, dir)
    const result = await service.save({ fileName: 'out.json', content: '{"a":1}' })
    expect(result.saveDir).toBe(dir)
    expect(result.bytes).toBe(7)
    expect(result.path).toBe(join(dir, 'out.json'))
    expect(JSON.parse(readFileSync(result.path, 'utf8'))).toEqual({ a: 1 })
  })

  it('save counts UTF-8 bytes, not code points', async () => {
    const dir = tmpDir()
    const service = new ToolboxService(new Context(), dir)
    const result = await service.save({ fileName: 'cn.txt', content: '你好' })
    expect(result.bytes).toBe(6)
  })

  it('save sanitizes traversal names and creates subdirs', async () => {
    const dir = tmpDir()
    const service = new ToolboxService(new Context(), dir)
    const result = await service.save({ fileName: '../../etc/passwd', content: 'x', subdir: 'logs/2026' })
    expect(result.path).toBe(join(dir, 'logs', '2026', 'passwd'))
    expect(result.path.startsWith(dir)).toBe(true)
    expect(existsSync(result.path)).toBe(true)
  })

  it('save neutralizes traversal subdirs', async () => {
    const dir = tmpDir()
    const service = new ToolboxService(new Context(), dir)
    const result = await service.save({ fileName: 'a.txt', content: 'x', subdir: '../..' })
    expect(result.path).toBe(join(dir, 'a.txt'))
  })
})

describe('resolveSaveDir', () => {
  it('joins relative config against the file base url', () => {
    expect(ToolboxService.resolveSaveDir('file:///home/jean/program', 'toolbox-saves'))
      .toBe('/home/jean/program/toolbox-saves')
  })

  it('falls back to the cwd without a base url', () => {
    expect(ToolboxService.resolveSaveDir(undefined, 'saves')).toBe(join(process.cwd(), 'saves'))
  })

  it('treats non-file base urls as paths', () => {
    expect(ToolboxService.resolveSaveDir('/base/dir', 'saves')).toBe(join('/base/dir', 'saves'))
  })

  it('keeps absolute configured dirs untouched', () => {
    expect(ToolboxService.resolveSaveDir('/base', '/abs/saves')).toBe('/abs/saves')
  })
})
