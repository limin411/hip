/** Single large-doc threshold used everywhere (edit, index, snapshots). */
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
