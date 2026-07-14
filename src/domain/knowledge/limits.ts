/**
 * Shared knowledge-base size / UX limits.
 * Single source of truth for large-doc, index, and related caps.
 */

/**
 * Large-doc threshold for open/edit/snapshot guards (P0.7+).
 * Not yet consumed by edit paths in this PR — reserved so later PRs share one value.
 * MiniSearch body indexing uses `KNOWLEDGE_INDEX_BODY_CHARS` instead.
 */
export const KNOWLEDGE_LARGE_DOC_CHARS = 512_000

/** MiniSearch indexes at most this many body chars after frontmatter strip. */
export const KNOWLEDGE_INDEX_BODY_CHARS = 512_000

/** Recent docs cap (localStorage). */
export const KNOWLEDGE_RECENT_CAP = 8

/**
 * Max asset size on disk (import from path / file picker).
 * Not the same as what may cross the WebView as base64.
 */
export const KNOWLEDGE_ASSET_MAX_BYTES = 25 * 1024 * 1024

/**
 * Max raw bytes for IPC base64 round-trips (`read_asset_data`, paste `import_asset_bytes`).
 * ~1.5MB raw ≈ ~2MB base64 + JSON framing.
 */
export const KNOWLEDGE_ASSET_INLINE_MAX_BYTES = 1_500_000

/** Versions retained per doc (Phase 1). */
export const KNOWLEDGE_VERSION_CAP = 30
/** MiniSearch indexes at most this many body chars (after frontmatter strip). */
 * Target recent-docs cap (localStorage) for P0.4 tree/nav work.
 * Home may still use a lower in-file cap until that PR lands.
export const KNOWLEDGE_RECENT_CAP = 16
/** Yield to the event loop every N docs during full index rebuild. */
export const KNOWLEDGE_INDEX_YIELD_EVERY = 20
