/**
 * Platform window frame (decorations / shadow).
 * Windows: frameless + custom caption buttons (see WindowCaptionButtons).
 * macOS / Linux: leave native / Overlay chrome alone.
 */

import { isWindowsPlatform } from './platform'

export type CaptionMode = 'custom' | 'system'

export function markCaptionMode(mode: CaptionMode | null): void {
  if (typeof document === 'undefined') return
  if (mode === 'custom') document.documentElement.dataset.caption = 'custom'
  else delete document.documentElement.dataset.caption
}

export function isCustomCaptionActive(): boolean {
  if (typeof document === 'undefined') return false
  return document.documentElement.dataset.caption === 'custom'
}

/**
 * Apply host chrome. Safe outside Tauri (no-op).
 * Only Windows requests frameless so Overlay traffic lights stay on macOS.
 */
export async function applyPlatformWindowChrome(): Promise<boolean> {
  if (!isWindowsPlatform()) {
    markCaptionMode(null)
    return false
  }

  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const win = getCurrentWindow()
    await win.setDecorations(false)
    await win.setShadow(true).catch(() => {
      /* shadow unsupported / denied — frameless still useful */
    })
    markCaptionMode('custom')
    return true
  } catch {
    markCaptionMode(null)
    return false
  }
}
