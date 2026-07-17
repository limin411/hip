// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyPlatformDataset,
  detectHipPlatform,
  isLinuxPlatform,
  isMacPlatform,
  isWindowsPlatform,
} from './platform'

describe('platform', () => {
  afterEach(() => {
    delete document.documentElement.dataset.platform
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('detects mac from platform string', () => {
    vi.stubGlobal('navigator', {
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    })
    expect(detectHipPlatform()).toBe('mac')
    expect(isMacPlatform()).toBe(true)
    expect(isWindowsPlatform()).toBe(false)
  })

  it('detects windows from Win32', () => {
    vi.stubGlobal('navigator', {
      platform: 'Win32',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    })
    expect(detectHipPlatform()).toBe('windows')
    expect(isWindowsPlatform()).toBe(true)
  })

  it('detects linux from Linux UA (non-mac platform)', () => {
    vi.stubGlobal('navigator', {
      platform: 'Linux x86_64',
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
    })
    expect(detectHipPlatform()).toBe('linux')
    expect(isLinuxPlatform()).toBe(true)
  })

  it('applyPlatformDataset writes data-platform', () => {
    vi.stubGlobal('navigator', {
      platform: 'Win32',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    })
    expect(applyPlatformDataset()).toBe('windows')
    expect(document.documentElement.dataset.platform).toBe('windows')
  })
})
