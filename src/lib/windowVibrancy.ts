/**
 * Native window vibrancy (desktop wallpaper / DWM material under transparent regions).
 *
 * Sidebar glass (see DESIGN.md §8): on macOS / Windows the window is transparent
 * and tauri.conf `windowEffects` applies the native material at creation
 * (macOS `sidebar` vibrancy / Windows `acrylic`, falling back to `mica`).
 * This module only syncs the window theme and marks the CSS hook (`data-vibrancy`)
 * so styles can tell real-material platforms apart; on Linux (no transparent
 * windows in Tauri) and outside Tauri it stays `solid`.
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
 * Mark the CSS hook for the active material.
 * macOS → `mac-sidebar`; Windows → `win-acrylic` (tauri.conf prefers acrylic,
 * falls back to mica automatically); Linux / outside Tauri → `solid`.
 * Safe outside Tauri (marks solid, returns false).
 */
export async function enableNativeVibrancy(): Promise<boolean> {
  const platform = detectHipPlatform()
  let mode: VibrancyMode = 'solid'

  if (platform === 'mac' || platform === 'windows') {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      const dark = isDarkDocument()

      await win.setTheme(dark ? 'dark' : 'light').catch(() => {
        /* setTheme not available / denied — chrome color sync is optional */
      })
      mode = platform === 'mac' ? 'mac-sidebar' : 'win-acrylic'
    } catch {
      /* not in Tauri — solid anyway */
      mode = 'solid'
    }
  }

  markVibrancyMode(mode)
  return mode !== 'solid'
}

/** Re-apply after theme toggle (window theme + acrylic tint). */
export async function syncVibrancyWithTheme(): Promise<void> {
  await enableNativeVibrancy()
}
