// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  detectVibrancyPlatform,
  enableNativeVibrancy,
  getVibrancyMode,
  markNativeVibrancy,
  markVibrancyMode,
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

  it('markVibrancyMode sets data-vibrancy modes', () => {
    markVibrancyMode('win-mica')
    expect(getVibrancyMode()).toBe('win-mica')
    markVibrancyMode('solid')
    expect(getVibrancyMode()).toBe('solid')
    markVibrancyMode(null)
    expect(getVibrancyMode()).toBeNull()
  })

  it('markNativeVibrancy legacy helper maps to mac-sidebar / clear', () => {
    markNativeVibrancy(true)
    expect(document.documentElement.dataset.vibrancy).toBe('mac-sidebar')
    markNativeVibrancy(false)
    expect(document.documentElement.dataset.vibrancy).toBeUndefined()
  })

  it('enableNativeVibrancy marks solid when not in Tauri on mac', async () => {
    vi.stubGlobal('navigator', {
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh)',
    })
    const ok = await enableNativeVibrancy()
    expect(ok).toBe(false)
    expect(getVibrancyMode()).toBe('solid')
  })

  it('enableNativeVibrancy marks solid on linux without Tauri', async () => {
    vi.stubGlobal('navigator', {
      platform: 'Linux x86_64',
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
    })
    const ok = await enableNativeVibrancy()
    expect(ok).toBe(false)
    expect(getVibrancyMode()).toBe('solid')
  })

  it('enableNativeVibrancy marks mac-sidebar inside Tauri on mac', async () => {
    vi.stubGlobal('navigator', {
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh)',
    })
    vi.doMock('@tauri-apps/api/window', () => ({
      getCurrentWindow: () => ({ setTheme: vi.fn().mockResolvedValue(undefined) }),
    }))
    const ok = await enableNativeVibrancy()
    expect(ok).toBe(true)
    expect(getVibrancyMode()).toBe('mac-sidebar')
  })

  it('enableNativeVibrancy marks win-acrylic inside Tauri on windows', async () => {
    vi.stubGlobal('navigator', {
      platform: 'Win32',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    })
    vi.doMock('@tauri-apps/api/window', () => ({
      getCurrentWindow: () => ({ setTheme: vi.fn().mockResolvedValue(undefined) }),
    }))
    const ok = await enableNativeVibrancy()
    expect(ok).toBe(true)
    expect(getVibrancyMode()).toBe('win-acrylic')
  })
})
