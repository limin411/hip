import { describe, expect, it } from 'vitest'
import { join, sep } from 'node:path'
import { resolveDiscoveryPath, resolveHipBaseDir } from './hip-base.js'

describe('resolveHipBaseDir', () => {
  it('honors HIP_DATA_DIR', () => {
    const result = resolveHipBaseDir({ HIP_DATA_DIR: '/tmp/isolated-hip' }, 'darwin')
    // On Windows, path.resolve converts Unix paths to Windows format
    if (sep === '\\') {
      expect(result).toMatch(/isolated-hip$/)
    } else {
      expect(result).toBe('/tmp/isolated-hip')
    }
  })

  it('unix uses $HOME/.hip', () => {
    // On Windows, join converts Unix paths to Windows format
    if (sep === '\\') {
      expect(resolveHipBaseDir({ HOME: '/Users/x' }, 'darwin')).toMatch(/\.hip$/)
      expect(resolveHipBaseDir({ HOME: '/home/u' }, 'linux')).toMatch(/\.hip$/)
    } else {
      expect(resolveHipBaseDir({ HOME: '/Users/x' }, 'darwin')).toBe('/Users/x/.hip')
      expect(resolveHipBaseDir({ HOME: '/home/u' }, 'linux')).toBe('/home/u/.hip')
    }
  })

  it('windows uses USERPROFILE/.hip (not APPDATA)', () => {
    const base = resolveHipBaseDir(
      { USERPROFILE: 'C:\\Users\\Admin', APPDATA: 'C:\\AppData' },
      'win32',
    )
    expect(base).toBe(join('C:\\Users\\Admin', '.hip'))
    expect(base).not.toContain('AppData')
    expect(base).not.toContain('com.ljm.hip')
  })

  it('windows prefers HOME over USERPROFILE when both set', () => {
    expect(
      resolveHipBaseDir(
        { HOME: 'C:\\Users\\from-home', USERPROFILE: 'C:\\Users\\from-profile' },
        'win32',
      ),
    ).toBe(join('C:\\Users\\from-home', '.hip'))
  })
})

describe('resolveDiscoveryPath', () => {
  it('appends run/sidecar.json', () => {
    const p = resolveDiscoveryPath({ HOME: '/Users/x' }, 'darwin')
    // Normalize separators for cross-platform comparison
    const normalized = p.replace(/\\/g, '/')
    expect(normalized).toMatch(/\.hip\/run\/sidecar\.json$/)
  })
})