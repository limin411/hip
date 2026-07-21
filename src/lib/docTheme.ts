/**
 * Shared document-level dark theme helpers.
 * One MutationObserver on documentElement for all subscribers (Live Shiki,
 * KnowledgeMermaid, etc.).
 */

export function isDocDark(): boolean {
  return (
    typeof document !== 'undefined' &&
    document.documentElement.classList.contains('dark')
  )
}

type ThemeListener = () => void
const themeListeners = new Set<ThemeListener>()
let themeObserver: MutationObserver | null = null

/** Subscribe to `documentElement` class changes (dark theme toggle). */
export function subscribeDocTheme(listener: ThemeListener): () => void {
  themeListeners.add(listener)
  if (!themeObserver && typeof document !== 'undefined') {
    themeObserver = new MutationObserver(() => {
      for (const l of themeListeners) l()
    })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })
  }
  return () => {
    themeListeners.delete(listener)
    if (themeListeners.size === 0 && themeObserver) {
      themeObserver.disconnect()
      themeObserver = null
    }
  }
}
