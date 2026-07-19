/**
 * Shared knowledge-base size / UX limits.
 * Single source of truth for large-doc, index, and related caps.
 */

/** Single large-doc threshold used everywhere (edit, index, snapshots). */
export const KNOWLEDGE_LARGE_DOC_CHARS = 512_000

/** MiniSearch indexes at most this many body chars (after frontmatter strip). */
export const KNOWLEDGE_INDEX_BODY_CHARS = 512_000

/** Recent docs cap (localStorage). */
export const KNOWLEDGE_RECENT_CAP = 16

/**
 * Max asset size on disk (import from path / file picker).
 * Not the same as what may cross the WebView as base64.
 */
export const KNOWLEDGE_ASSET_MAX_BYTES = 25 * 1024 * 1024

/**
 * Max raw bytes for IPC base64 round-trips (`read_asset_data`, paste `import_asset_bytes`).
 * ~1.5MB raw ≈ ~2MB base64 + JSON framing — keeps invoke off the PTY-scale freeze path.
 */
export const KNOWLEDGE_ASSET_INLINE_MAX_BYTES = 1_500_000

/** Versions retained per doc (Phase 1). */
export const KNOWLEDGE_VERSION_CAP = 30

/** Max tags per document (UI + meta write path). */
export const KNOWLEDGE_TAGS_MAX = 5

/** Yield to the event loop every N docs during full index rebuild. */
export const KNOWLEDGE_INDEX_YIELD_EVERY = 20

/** Local calendar day key `YYYY-MM-DD` for daily snapshots (system local TZ). */
export function localDayKey(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
