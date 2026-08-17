import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { sanitizeFileName, sanitizeSubdir } from '../src/service.ts'
import { convertFileEncoding, hashFile } from '../src/hostTools.ts'

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
})
