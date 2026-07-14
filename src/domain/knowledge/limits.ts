/**
 * Shared knowledge-base size / UX limits.
 * Single source of truth for large-doc, index, and related caps.
 */

/** Single large-doc threshold used everywhere (edit, index, snapshots). */
export const KNOWLEDGE_LARGE_DOC_CHARS = 512_000

/** MiniSearch indexes at most this many body chars (after frontmatter strip later). */
export const KNOWLEDGE_INDEX_BODY_CHARS = 512_000

/** Recent docs cap (localStorage). */
export const KNOWLEDGE_RECENT_CAP = 16

/** Yield to the event loop every N docs during full index rebuild. */
export const KNOWLEDGE_INDEX_YIELD_EVERY = 20
