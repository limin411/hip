/** Three-way document pane mode (Live / Source / Preview). */
export type EditorMode = 'live' | 'source' | 'preview'

/** Writable modes that schedule autosave on draft changes. */
export type WritableEditorMode = 'live' | 'source'

/** localStorage: Live editor feature flag (default off until quality gate). */
export const KNOWLEDGE_LIVE_FLAG_KEY = 'hip-knowledge-live'

/** localStorage: last non-preview mode preference (`live` | `source`). */
export const KNOWLEDGE_EDITOR_MODE_PREF_KEY = 'hip-knowledge-editor-mode'

/** Autosave default when user types in Live or Source (not Preview). */
export function shouldAutosave(mode: EditorMode): boolean {
  return mode === 'live' || mode === 'source'
}

/** Whether Live mode is enabled via localStorage flag. */
export function isKnowledgeLiveEnabled(): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem(KNOWLEDGE_LIVE_FLAG_KEY) === 'true'
  } catch {
    return false
  }
}

/**
 * Preferred writable mode when opening a doc.
 * - Flag off → always `source`
 * - Flag on + stored pref → that pref (live|source)
 * - Flag on + no pref → `live`
 */
export function loadEditorModePref(): WritableEditorMode {
  if (!isKnowledgeLiveEnabled()) return 'source'
  if (typeof localStorage === 'undefined') return 'live'
  try {
    const v = localStorage.getItem(KNOWLEDGE_EDITOR_MODE_PREF_KEY)
    if (v === 'source') return 'source'
    if (v === 'live') return 'live'
    return 'live'
  } catch {
    return 'live'
  }
}

/** Persist last writable mode (ignore preview). */
export function persistEditorModePref(mode: WritableEditorMode): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(KNOWLEDGE_EDITOR_MODE_PREF_KEY, mode)
  } catch {
    // ignore quota
  }
}

/**
 * Clamp requested mode: Live without flag becomes Source.
 * Call sites can still store `live` only when flag is on.
 */
export function resolveEditorMode(mode: EditorMode): EditorMode {
  if (mode === 'live' && !isKnowledgeLiveEnabled()) return 'source'
  return mode
}
