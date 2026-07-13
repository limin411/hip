import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import {
  compileGrepPattern,
  isExcludedDirName,
  resolveFull,
  sliceFileLines,
  toGlobRegex,
} from './helpers.js'

describe('compileGrepPattern', () => {
  it('strips leading (?i) and matches case-insensitively', () => {
    const r = compileGrepPattern('(?i)zuolin|zuo_lin|zuo-lin')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.re.test('ZuolinConfig')).toBe(true)
    expect(r.re.test('zuolin')).toBe(true)
    expect(r.notes.some((n) => n.includes('(?i)'))).toBe(true)
  })

  it('honors caseInsensitive without inline flags', () => {
    const r = compileGrepPattern('zuolin', true)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.re.test('Zuolin')).toBe(true)
  })

  it('keeps case-sensitive match by default', () => {
    const r = compileGrepPattern('zuolin')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.re.test('zuolin')).toBe(true)
    expect(r.re.test('Zuolin')).toBe(false)
  })

  it('returns a hint on invalid regex', () => {
    const r = compileGrepPattern('(unclosed')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatch(/invalid regex/i)
    expect(r.error).toMatch(/caseInsensitive/i)
  })

  it('maps (?im) to JS flags', () => {
    const r = compileGrepPattern('(?im)^foo')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.re.flags).toContain('i')
    expect(r.re.flags).toContain('m')
  })
})

describe('toGlobRegex', () => {
  it('is case-sensitive by default', () => {
    const rx = toGlobRegex('**/*sync*')
    expect(rx.test('/permission/config/SyncDataConfig.java')).toBe(false)
    expect(rx.test('/permission/config/syncDataConfig.java')).toBe(true)
  })

  it('matches case-insensitively when requested', () => {
    const rx = toGlobRegex('**/*sync*', true)
    expect(rx.test('/permission/config/SyncDataConfig.java')).toBe(true)
    expect(rx.test('/permission/config/syncDataConfig.java')).toBe(true)
  })
})

describe('sliceFileLines', () => {
  const sample = ['L1', 'L2', 'L3', 'L4', 'L5'].join('\n')

  it('returns full text when offset/limit omitted', () => {
    expect(sliceFileLines(sample).text).toBe(sample)
    expect(sliceFileLines(sample).totalLines).toBe(5)
  })

  it('applies 1-based offset and limit', () => {
    const r = sliceFileLines(sample, 2, 2)
    expect(r.text).toContain('L2')
    expect(r.text).toContain('L3')
    expect(r.text).not.toMatch(/^L1/)
    expect(r.text).toMatch(/lines 2-3 of 5/)
    expect(r.text).toMatch(/offset=4/)
  })

  it('returns error when offset is past EOF', () => {
    const r = sliceFileLines(sample, 99)
    expect(r.text).toMatch(/past end of file/i)
  })
})

describe('isExcludedDirName', () => {
  it('excludes node_modules, .git, and Windows recycle bin variants', () => {
    expect(isExcludedDirName('node_modules')).toBe(true)
    expect(isExcludedDirName('.git')).toBe(true)
    expect(isExcludedDirName('$RECYCLE.BIN')).toBe(true)
    expect(isExcludedDirName('$Recycle.Bin')).toBe(true)
    expect(isExcludedDirName('System Volume Information')).toBe(true)
    expect(isExcludedDirName('src')).toBe(false)
  })
})

describe('resolveFull', () => {
  const cwd = path.resolve('/tmp/hip-project')

  it('maps bare / and empty string to cwd (never OS drive/FS root alone)', () => {
    expect(resolveFull(cwd, '/')).toBe(path.resolve(cwd))
    expect(resolveFull(cwd, '')).toBe(path.resolve(cwd))
  })

  it('resolves relative paths against cwd', () => {
    expect(resolveFull(cwd, 'src/a.ts')).toBe(path.resolve(cwd, 'src/a.ts'))
    expect(resolveFull(cwd, '.')).toBe(path.resolve(cwd))
  })

  it('keeps real OS absolute paths outside the project (POSIX / full-mode grant)', () => {
    if (process.platform === 'win32') {
      const abs = 'D:\\other\\file.txt'
      expect(resolveFull(cwd, abs)).toBe(path.normalize(abs))
    } else {
      expect(resolveFull(cwd, '/var/tmp/outside.txt')).toBe(path.normalize('/var/tmp/outside.txt'))
    }
  })

  it('on Windows maps /src form under cwd, not the drive root', () => {
    if (process.platform !== 'win32') return
    const resolved = resolveFull('D:\\proj', '/src/a.ts')
    expect(resolved.toLowerCase()).toContain(path.join('proj', 'src', 'a.ts').toLowerCase())
    expect(resolved).not.toMatch(/^[a-zA-Z]:\\src\\/i)
  })
})
