/**
 * Copy text to the clipboard. Tries the async Clipboard API first (works in a
 * secure context under a user gesture), then falls back to a hidden-textarea
 * execCommand for environments where it is blocked. Returns whether it succeeded.
 *
 * If the bundled WKWebView blocks both, swap this for @tauri-apps/plugin-clipboard-manager
 * (requires the cargo plugin + a clipboard-manager:allow-write capability).
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

/**
 * Read text from the system clipboard (async Clipboard API only).
 * Returns null when unavailable or permission is denied (common outside a user gesture).
 */
export async function readText(): Promise<string | null> {
  try {
    if (navigator.clipboard?.readText) {
      return await navigator.clipboard.readText()
    }
  } catch {
    // permission denied or non-secure context
  }
  return null
}
