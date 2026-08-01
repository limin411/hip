/**
 * Native window vibrancy (desktop wallpaper / DWM material under transparent regions).
 *
 * Flat design (see docs/flat-design-spec.md §4.5): translucent materials are removed.
 * `data-vibrancy` is always `solid`; `setTheme` still syncs window chrome to the
 * app theme. Legacy modes (`mac-sidebar` / `win-mica` / `win-acrylic`) are still
 * readable by getVibrancyMode but never written by this module.
 */

import { detectHipPlatform, type HipPlatform } from './platform'

/** @deprecated Prefer detectHipPlatform — kept for call-site compatibility. */
export type VibrancyPlatform = HipPlatform

export type VibrancyMode = 'mac-sidebar' | 'win-mica' | 'win-acrylic' | 'solid'

export function detectVibrancyPlatform(): VibrancyPlatform {
  return detectHipPlatform()
}

function isDarkDocument(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
}

/** Mark vibrancy mode for CSS. `null` clears the attribute (browser pre-init). */
export function markVibrancyMode(mode: VibrancyMode | null): void {
  if (typeof document === 'undefined') return
  if (mode == null) delete document.documentElement.dataset.vibrancy
  else document.documentElement.dataset.vibrancy = mode
}

/** @deprecated Use markVibrancyMode — maps boolean to solid | null for tests. */
export function markNativeVibrancy(active: boolean): void {
  if (active) markVibrancyMode('mac-sidebar')
  else markVibrancyMode(null)
}

export function getVibrancyMode(): VibrancyMode | null {
  if (typeof document === 'undefined') return null
  const v = document.documentElement.dataset.vibrancy
  if (
    v === 'mac-sidebar' ||
    v === 'win-mica' ||
    v === 'win-acrylic' ||
    v === 'solid'
  ) {
    return v
  }
  // Legacy value from older builds
  if (v === 'native') return 'mac-sidebar'
  return null
}

/**
 * Apply platform window effects. Safe outside Tauri (marks solid / clears, returns false).
 * Flat design: no translucency — always solid; only the window theme is synced.
 * Idempotent enough to re-run when app theme changes.
 */
export async function enableNativeVibrancy(): Promise<boolean> {
  const platform = detectHipPlatform()

  if (platform !== 'mac' && platform !== 'windows') {
    markVibrancyMode('solid')
    return false
  }

  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const win = getCurrentWindow()
    const dark = isDarkDocument()

    await win.setTheme(dark ? 'dark' : 'light').catch(() => {
      /* setTheme not available / denied — chrome color sync is optional */
    })
  } catch {
    /* not in Tauri — solid anyway */
  }

  markVibrancyMode('solid')
  return false
}

/** Re-apply after theme toggle (window theme + acrylic tint). */
export async function syncVibrancyWithTheme(): Promise<void> {
  await enableNativeVibrancy()
}
