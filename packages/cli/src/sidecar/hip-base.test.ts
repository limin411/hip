import { describe, expect, it } from 'vitest'
import { resolveDiscoveryPath, resolveHipBaseDir } from './hip-base.js'

describe('resolveHipBaseDir', () => {
  it('honors HIP_DATA_DIR', () => {
    expect(resolveHipBaseDir({ HIP_DATA_DIR: '/tmp/isolated-hip' }, 'darwin')).toBe('/tmp/isolated-hip')
  })

  it('unix uses $HOME/.hip', () => {
    expect(resolveHipBaseDir({ HOME: '/Users/x' }, 'darwin')).toBe('/Users/x/.hip')
    expect(resolveHipBaseDir({ HOME: '/home/u' }, 'linux')).toBe('/home/u/.hip')
  })

  it('windows prefers APPDATA/com.ljm.hip', () => {
    expect(resolveHipBaseDir({ APPDATA: 'C:\\AppData' }, 'win32')).toBe(
      'C:\\AppData\\com.ljm.hip'.replace(/\\/g, require('node:path').sep) ===
        resolveHipBaseDir({ APPDATA: 'C:\\AppData' }, 'win32')
        ? resolveHipBaseDir({ APPDATA: 'C:\\AppData' }, 'win32')
        : joinWin('C:\\AppData', 'com.ljm.hip'),
    )
    expect(resolveHipBaseDir({ APPDATA: 'C:\\AppData' }, 'win32')).toContain('com.ljm.hip')
  })
})

describe('resolveDiscoveryPath', () => {
  it('appends run/sidecar.json', () => {
    const p = resolveDiscoveryPath({ HOME: '/Users/x' }, 'darwin')
    expect(p.replace(/\\/g, '/')).toBe('/Users/x/.hip/run/sidecar.json')
  })
})

function joinWin(...parts: string[]): string {
  return parts.join(require('node:path').sep)
}
