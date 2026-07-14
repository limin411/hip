/** Single large-doc threshold used everywhere (edit, index, snapshots). */
export const KNOWLEDGE_LARGE_DOC_CHARS = 512_000
/**
 * Shared knowledge-base size / UX limits.
 * Single source of truth for large-doc, index, and related caps.
 */

/**
 * Large-doc threshold for open/edit/snapshot guards (P0.7+).
 * Not yet consumed by edit paths in this PR — reserved so later PRs share one value.
 * MiniSearch body indexing uses `KNOWLEDGE_INDEX_BODY_CHARS` instead.
 */

/** MiniSearch indexes at most this many body chars (after frontmatter strip). */
export const KNOWLEDGE_INDEX_BODY_CHARS = 512_000

/**
 * Target recent-docs cap (localStorage) for P0.4 tree/nav work.
 * Home may still use a lower in-file cap until that PR lands.
 */
export const KNOWLEDGE_RECENT_CAP = 16

/** Yield to the event loop every N docs during full index rebuild. */
export const KNOWLEDGE_INDEX_YIELD_EVERY = 20
