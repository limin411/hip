import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import {
  compileGrepPattern,
  isExcludedDirName,
  resetRgBinCache,
  resolveFull,
  resolveRgBin,
  runRgGrep,
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

describe('resolveRgBin / runRgGrep', () => {
  const prevHipRg = process.env.HIP_RG_BIN
  const prevHipData = process.env.HIP_DATA_DIR

  beforeEach(() => {
    resetRgBinCache()
    delete process.env.HIP_RG_BIN
    delete process.env.HIP_DATA_DIR
  })

  afterEach(() => {
    resetRgBinCache()
    if (prevHipRg === undefined) delete process.env.HIP_RG_BIN
    else process.env.HIP_RG_BIN = prevHipRg
    if (prevHipData === undefined) delete process.env.HIP_DATA_DIR
    else process.env.HIP_DATA_DIR = prevHipData
  })

  it('honors HIP_RG_BIN when the path is executable', () => {
    // System rg is expected on dev machines; skip soft if absent.
    const system = resolveRgBin()
    if (!system) return
    resetRgBinCache()
    process.env.HIP_RG_BIN = system
    expect(resolveRgBin()).toBe(system)
  })

  it('runRgGrep returns null when binary is missing', async () => {
    const out = await runRgGrep({
      pattern: 'x',
      absPath: process.cwd(),
      scanBase: process.cwd(),
      rgBin: path.join(tmpdir(), 'hip-no-such-rg-binary'),
    })
    expect(out).toBeNull()
  })

  it('runRgGrep finds matches and skips node_modules', async () => {
    const bin = resolveRgBin()
    if (!bin) return // environment without rg — JS fallback covered elsewhere

    const dir = mkdtempSync(path.join(tmpdir(), 'hip-rg-'))
    try {
      mkdirSync(path.join(dir, 'node_modules', 'pkg'), { recursive: true })
      writeFileSync(path.join(dir, 'node_modules', 'pkg', 'a.js'), 'NEEDLE hidden')
      writeFileSync(path.join(dir, 'app.js'), 'NEEDLE visible\n')
      const out = await runRgGrep({
        pattern: 'NEEDLE',
        absPath: dir,
        scanBase: dir,
        rgBin: bin,
      })
      expect(out).toBeTruthy()
      expect(out!).toContain('/app.js')
      expect(out!).toContain('NEEDLE visible')
      expect(out!).not.toContain('node_modules')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('runRgGrep honors caseInsensitive and (?i)', async () => {
    const bin = resolveRgBin()
    if (!bin) return

    const dir = mkdtempSync(path.join(tmpdir(), 'hip-rg-ci-'))
    try {
      writeFileSync(path.join(dir, 'Cfg.java'), 'class ZuolinConfig {}\n')
      const viaFlag = await runRgGrep({
        pattern: 'zuolin',
        absPath: dir,
        scanBase: dir,
        caseInsensitive: true,
        rgBin: bin,
      })
      expect(viaFlag).toMatch(/ZuolinConfig/)
      const viaInline = await runRgGrep({
        pattern: '(?i)zuolin',
        absPath: dir,
        scanBase: dir,
        rgBin: bin,
      })
      expect(viaInline).toMatch(/ZuolinConfig/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('runRgGrep reports no matches cleanly', async () => {
    const bin = resolveRgBin()
    if (!bin) return

    const dir = mkdtempSync(path.join(tmpdir(), 'hip-rg-empty-'))
    try {
      writeFileSync(path.join(dir, 'a.txt'), 'hello\n')
      const out = await runRgGrep({
        pattern: 'ZZZ_NO_MATCH_ZZZ',
        absPath: dir,
        scanBase: dir,
        rgBin: bin,
      })
      expect(out).toMatch(/No matches/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
