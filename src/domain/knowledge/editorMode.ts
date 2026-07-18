/** Three-way document pane mode (Live / Source / Preview). */
export type EditorMode = 'live' | 'source' | 'preview'

/** Writable modes that schedule autosave on draft changes. */
export type WritableEditorMode = 'live' | 'source'

/**
 * localStorage: Live editor feature flag (product-on by default for 所见即所得).
 * - Key absent / missing storage → **on** (default WYSIWYG edit)
 * - Exact `"false"` → off (explicit opt-out; Source is primary edit path)
 * - Exact `"true"` → on (explicit opt-in; same as default)
 * - Any other value → off (conservative; treat as non-enabled)
 */
export const KNOWLEDGE_LIVE_FLAG_KEY = 'hip-knowledge-live'

/** localStorage: last non-preview mode preference (`live` | `source`). */
export const KNOWLEDGE_EDITOR_MODE_PREF_KEY = 'hip-knowledge-editor-mode'

/** Autosave default when user types in Live or Source (not Preview). */
export function shouldAutosave(mode: EditorMode): boolean {
  return mode === 'live' || mode === 'source'
}

/**
 * Whether Live mode is enabled (product default on).
 * - Key absent / missing storage → true
 * - Exact `"true"` → true
 * - Exact `"false"` or any other value → false
 */
export function isKnowledgeLiveEnabled(): boolean {
  if (typeof localStorage === 'undefined') return true
  try {
    const v = localStorage.getItem(KNOWLEDGE_LIVE_FLAG_KEY)
    if (v === null) return true
    return v === 'true'
  } catch {
    return true
  }
}

/**
 * Preferred writable mode when opening a doc / starting edit.
 * - Flag off → always `source`
 * - Flag on + stored pref → that pref (live|source)
 * - Flag on + no pref → `live` (所见即所得 default)
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
