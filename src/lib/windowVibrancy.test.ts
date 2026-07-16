// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  detectVibrancyPlatform,
  enableNativeVibrancy,
  markNativeVibrancy,
} from './windowVibrancy'

describe('windowVibrancy', () => {
  afterEach(() => {
    delete document.documentElement.dataset.vibrancy
    document.documentElement.classList.remove('dark')
    vi.unstubAllGlobals()
    vi.resetModules()
    vi.restoreAllMocks()
  })

  it('detectVibrancyPlatform maps Mac UA to mac', () => {
    vi.stubGlobal('navigator', {
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    })
    expect(detectVibrancyPlatform()).toBe('mac')
  })

  it('detectVibrancyPlatform maps Win UA to windows', () => {
    vi.stubGlobal('navigator', {
      platform: 'Win32',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    })
    expect(detectVibrancyPlatform()).toBe('windows')
  })

  it('markNativeVibrancy toggles data-vibrancy', () => {
    markNativeVibrancy(true)
    expect(document.documentElement.dataset.vibrancy).toBe('native')
    markNativeVibrancy(false)
    expect(document.documentElement.dataset.vibrancy).toBeUndefined()
  })

  it('enableNativeVibrancy returns false when not in Tauri / API missing', async () => {
    vi.stubGlobal('navigator', {
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh)',
    })
    // Dynamic import of @tauri-apps/api/window fails or setEffects throws in unit tests.
    const ok = await enableNativeVibrancy()
    expect(ok).toBe(false)
    expect(document.documentElement.dataset.vibrancy).toBeUndefined()
  })
})
