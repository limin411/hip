// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyPlatformWindowChrome,
  isCustomCaptionActive,
  markCaptionMode,
} from './windowChrome'

describe('windowChrome', () => {
  afterEach(() => {
    delete document.documentElement.dataset.caption
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('markCaptionMode toggles data-caption', () => {
    markCaptionMode('custom')
    expect(isCustomCaptionActive()).toBe(true)
    markCaptionMode(null)
    expect(isCustomCaptionActive()).toBe(false)
  })

  it('applyPlatformWindowChrome no-ops on mac', async () => {
    vi.stubGlobal('navigator', {
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh)',
    })
    const ok = await applyPlatformWindowChrome()
    expect(ok).toBe(false)
    expect(isCustomCaptionActive()).toBe(false)
  })

  it('applyPlatformWindowChrome fails closed without Tauri on windows', async () => {
    vi.stubGlobal('navigator', {
      platform: 'Win32',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    })
    const ok = await applyPlatformWindowChrome()
    expect(ok).toBe(false)
    expect(isCustomCaptionActive()).toBe(false)
  })
})
