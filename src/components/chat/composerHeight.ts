/** Persisted height (px) of the session composer textarea. */
export const COMPOSER_HEIGHT_KEY = 'hip.composerTextareaHeight'

export const COMPOSER_HEIGHT_DEFAULT = 40
export const COMPOSER_HEIGHT_MIN = 40
/** Upper bound as a fraction of the viewport height. */
export const COMPOSER_HEIGHT_MAX_RATIO = 0.45

export function maxComposerHeight(viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 900): number {
  return Math.max(COMPOSER_HEIGHT_MIN, Math.round(viewportHeight * COMPOSER_HEIGHT_MAX_RATIO))
}

export function clampComposerHeight(
  height: number,
  viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 900,
): number {
  if (!Number.isFinite(height)) return COMPOSER_HEIGHT_DEFAULT
  return Math.max(COMPOSER_HEIGHT_MIN, Math.min(maxComposerHeight(viewportHeight), Math.round(height)))
}

export function loadComposerHeight(): number {
  if (typeof localStorage === 'undefined') return COMPOSER_HEIGHT_DEFAULT
  try {
    const raw = localStorage.getItem(COMPOSER_HEIGHT_KEY)
    if (raw == null) return COMPOSER_HEIGHT_DEFAULT
    return clampComposerHeight(Number(raw))
  } catch {
    return COMPOSER_HEIGHT_DEFAULT
  }
}

export function saveComposerHeight(height: number): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(COMPOSER_HEIGHT_KEY, String(clampComposerHeight(height)))
  } catch {
    /* ignore quota */
  }
}

/** Drag-up grows the box: newHeight = startHeight + (startY - clientY). */
export function heightFromDrag(startHeight: number, startY: number, clientY: number, viewportHeight?: number): number {
  return clampComposerHeight(startHeight + (startY - clientY), viewportHeight)
}
