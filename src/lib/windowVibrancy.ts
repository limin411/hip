/**
 * Native window vibrancy (desktop wallpaper / DWM material under transparent regions).
 *
 * Modes written to `html[data-vibrancy]`:
 * - mac-sidebar — NSVisualEffect Sidebar
 * - win-mica — Windows 11 Mica
 * - win-acrylic — Acrylic fallback (thick tint; no CSS blur on top)
 * - solid — opaque host (Linux, failures, reduced transparency)
 *
 * Never leave semi-transparent `.glass-surface` without a real material underneath.
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
 * Idempotent enough to re-run when app theme changes.
 */
export async function enableNativeVibrancy(): Promise<boolean> {
  const platform = detectHipPlatform()

  if (platform !== 'mac' && platform !== 'windows') {
    markVibrancyMode('solid')
    return false
  }

  try {
    const { getCurrentWindow, Effect, EffectState } = await import('@tauri-apps/api/window')
    const win = getCurrentWindow()
    const dark = isDarkDocument()

    await win.setTheme(dark ? 'dark' : 'light').catch(() => {
      /* setTheme not available / denied — effects still useful */
    })

    if (platform === 'mac') {
      await win.setEffects({
        effects: [Effect.Sidebar],
        state: EffectState.FollowsWindowActiveState,
      })
      markVibrancyMode('mac-sidebar')
      return true
    }

    // Windows: Mica (Win11) → Acrylic (Win10) → solid (never treat Blur as glass success)
    try {
      await win.setEffects({ effects: [Effect.Mica] })
      markVibrancyMode('win-mica')
      return true
    } catch {
      try {
        await win.setEffects({
          effects: [Effect.Acrylic],
          color: dark ? [26, 26, 26, 220] : [245, 245, 245, 220],
        })
        markVibrancyMode('win-acrylic')
        return true
      } catch {
        markVibrancyMode('solid')
        return false
      }
    }
  } catch {
    markVibrancyMode('solid')
    return false
  }
}

/** Re-apply after theme toggle (window theme + acrylic tint). */
export async function syncVibrancyWithTheme(): Promise<void> {
  await enableNativeVibrancy()
}
