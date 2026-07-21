import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { resolveDiscoveryPath, resolveHipBaseDir } from './hip-base.js'

describe('resolveHipBaseDir', () => {
  it('honors HIP_DATA_DIR', () => {
    expect(resolveHipBaseDir({ HIP_DATA_DIR: '/tmp/isolated-hip' }, 'darwin')).toBe('/tmp/isolated-hip')
  })

  it('unix uses $HOME/.hip', () => {
    expect(resolveHipBaseDir({ HOME: '/Users/x' }, 'darwin')).toBe('/Users/x/.hip')
    expect(resolveHipBaseDir({ HOME: '/home/u' }, 'linux')).toBe('/home/u/.hip')
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
    expect(p.replace(/\\/g, '/')).toBe('/Users/x/.hip/run/sidecar.json')
  })
})
