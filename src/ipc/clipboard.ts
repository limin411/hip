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
  const prev =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    // Avoid scrolling / focus rings in embedded editors (ProseMirror).
    ta.setAttribute('readonly', '')
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    // Restore focus so Live code/diagram blocks do not lose the caret and
    // bounce from edit → preview after copy.
    if (prev && document.contains(prev)) {
      try {
        prev.focus()
      } catch {
        // ignore
      }
    }
    return ok
  } catch {
    if (prev && document.contains(prev)) {
      try {
        prev.focus()
      } catch {
        // ignore
      }
    }
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
