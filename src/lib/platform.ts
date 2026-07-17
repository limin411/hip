/**
 * Host OS detection for CSS (`data-platform`) and chrome/vibrancy branches.
 * Prefer this over ad-hoc navigator checks in layout components.
 */

export type HipPlatform = 'mac' | 'windows' | 'linux' | 'unknown'

export function detectHipPlatform(): HipPlatform {
  if (typeof navigator === 'undefined') return 'unknown'
  const platform = navigator.platform || ''
  const ua = navigator.userAgent || ''
  if (/Mac|iPhone|iPad|iPod/i.test(platform) || /Mac OS X/i.test(ua)) return 'mac'
  // Linux UA check must exclude Android if we ever run there; desktop only today.
  if (!/Mac|iPhone|iPad|iPod/i.test(platform) && /Linux/i.test(ua) && !/Android/i.test(ua)) {
    return 'linux'
  }
  if (/Win/i.test(platform) || /Windows/i.test(ua)) return 'windows'
  return 'unknown'
}

export function isMacPlatform(): boolean {
  return detectHipPlatform() === 'mac'
}

export function isWindowsPlatform(): boolean {
  return detectHipPlatform() === 'windows'
}

export function isLinuxPlatform(): boolean {
  return detectHipPlatform() === 'linux'
}

/** Apply `data-platform` on `<html>` for CSS. Safe in SSR / non-DOM. */
export function applyPlatformDataset(): HipPlatform {
  if (typeof document === 'undefined') return 'unknown'
  const platform = detectHipPlatform()
  if (platform === 'unknown') {
    // Default CSS windows/linux rules are safer than mac traffic-light inset.
    document.documentElement.dataset.platform = 'windows'
    return 'windows'
  }
  document.documentElement.dataset.platform = platform
  return platform
}
