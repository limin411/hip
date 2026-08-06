/**
 * Document pane mode.
 * Product path is always real-time Live (Notion/Feishu-style).
 * `source` is a silent fallback (large doc / parse fail / live flag off).
 * `preview` is **deprecated** as a writing mode — normalize to `live` on read.
 */
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

/** localStorage: last writable mode preference (`live` | `source`). */
export const KNOWLEDGE_EDITOR_MODE_PREF_KEY = 'hip-knowledge-editor-mode'

/**
 * localStorage: per-document mode map `{ [docId]: 'live' | 'source' }`.
 * Spec P1.6 — remember Source choice per doc so open does not bounce users.
 */
export const KNOWLEDGE_EDITOR_MODE_BY_DOC_KEY = 'hip-knowledge-editor-mode-by-doc'

/**
 * Autosave default when user types in a writable surface.
 * Legacy `preview` is treated as Live (writable) if still present in store.
 */
export function shouldAutosave(mode: EditorMode): boolean {
  return mode === 'live' || mode === 'source' || mode === 'preview'
}

function readDocModeMap(): Record<string, WritableEditorMode> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(KNOWLEDGE_EDITOR_MODE_BY_DOC_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, WritableEditorMode> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (v === 'live' || v === 'source') out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

/** Per-doc mode if stored; otherwise null (caller defaults to live). */
export function loadDocEditorMode(docId: string): WritableEditorMode | null {
  if (!docId || !isKnowledgeLiveEnabled()) return null
  return readDocModeMap()[docId] ?? null
}

/** Persist per-doc mode (also updates global last-writable pref). */
export function persistDocEditorMode(
  docId: string,
  mode: WritableEditorMode,
): void {
  if (!docId || typeof localStorage === 'undefined') return
  try {
    const map = readDocModeMap()
    map[docId] = mode
    // Cap map size to avoid unbounded growth
    const keys = Object.keys(map)
    if (keys.length > 200) {
      for (const k of keys.slice(0, keys.length - 200)) delete map[k]
    }
    localStorage.setItem(KNOWLEDGE_EDITOR_MODE_BY_DOC_KEY, JSON.stringify(map))
    localStorage.setItem(KNOWLEDGE_EDITOR_MODE_PREF_KEY, mode)
  } catch {
    // ignore quota
  }
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
 * Clamp requested mode:
 * - Deprecated `preview` writing mode → `live` (single-canvas product)
 * - Live without flag → Source
 */
export function resolveEditorMode(mode: EditorMode): EditorMode {
  // Writing Preview is not a product surface (R3 / Notion-Feishu single canvas).
  const base: EditorMode = mode === 'preview' ? 'live' : mode
  if (base === 'live' && !isKnowledgeLiveEnabled()) return 'source'
  return base
}
