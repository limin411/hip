/**
 * Native window vibrancy (desktop wallpaper / DWM blur under transparent regions).
 *
 * - macOS: NSVisualEffect Sidebar material
 * - Windows 11: Mica; Windows 10: Acrylic fallback
 * - Linux / browser: no native effect (CSS solid / glass fallback)
 *
 * Requires tauri.conf `transparent` + `macOSPrivateApi`, and opaque main chrome so only
 * the sidebar (and other transparent regions) show the system material.
 */

export type VibrancyPlatform = 'mac' | 'windows' | 'linux' | 'unknown'

export function detectVibrancyPlatform(): VibrancyPlatform {
  if (typeof navigator === 'undefined') return 'unknown'
  const ua = navigator.platform || navigator.userAgent
  if (/Mac|iPhone|iPad|iPod/i.test(ua)) return 'mac'
  if (!/Mac|iPhone|iPad|iPod/i.test(ua) && /Linux/i.test(navigator.userAgent)) return 'linux'
  if (/Win/i.test(ua) || /Windows/i.test(navigator.userAgent)) return 'windows'
  return 'unknown'
}

function isDarkDocument(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
}

/** Mark that native effects are active (CSS keys off `data-vibrancy="native"`). */
export function markNativeVibrancy(active: boolean): void {
  if (typeof document === 'undefined') return
  if (active) document.documentElement.dataset.vibrancy = 'native'
  else delete document.documentElement.dataset.vibrancy
}

/**
 * Apply platform window effects. Safe to call outside Tauri (no-ops, returns false).
 * Idempotent enough to re-run when app theme changes (acrylic color / window theme).
 */
export async function enableNativeVibrancy(): Promise<boolean> {
  const platform = detectVibrancyPlatform()
  if (platform !== 'mac' && platform !== 'windows') {
    markNativeVibrancy(false)
    return false
  }

  try {
    const { getCurrentWindow, Effect, EffectState } = await import('@tauri-apps/api/window')
    const win = getCurrentWindow()
    const dark = isDarkDocument()

    // Keep system material in sync with app theme (macOS appearance + Win tabbed variants).
    await win.setTheme(dark ? 'dark' : 'light').catch(() => {
      /* setTheme not available / denied — effects still useful */
    })

    if (platform === 'mac') {
      await win.setEffects({
        effects: [Effect.Sidebar],
        state: EffectState.FollowsWindowActiveState,
      })
    } else {
      // Prefer Mica (Win11). Acrylic works on Win10; Blur as last resort.
      try {
        await win.setEffects({ effects: [Effect.Mica] })
      } catch {
        try {
          await win.setEffects({
            effects: [Effect.Acrylic],
            // Tint helps acrylic read as sidebar chrome (ignored on some builds).
            color: dark ? [26, 26, 26, 200] : [245, 245, 245, 200],
          })
        } catch {
          await win.setEffects({
            effects: [Effect.Blur],
            color: dark ? [26, 26, 26, 200] : [245, 245, 245, 200],
          })
        }
      }
    }

    markNativeVibrancy(true)
    return true
  } catch {
    markNativeVibrancy(false)
    return false
  }
}

/** Re-apply after theme toggle (window theme + Win acrylic tint). */
export async function syncVibrancyWithTheme(): Promise<void> {
  if (typeof document === 'undefined') return
  if (document.documentElement.dataset.vibrancy !== 'native') {
    // First successful enable, or no-op on unsupported hosts.
    await enableNativeVibrancy()
    return
  }
  await enableNativeVibrancy()
}
