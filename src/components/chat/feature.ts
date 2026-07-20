/**
 * Transcript interleaved TurnBlocks (PR-5 / KD-2).
 *
 * When true, assistant turns with `kind:'text'` timeline steps render a single
 * global stepSeq stream (reasoning / supervisor text / tool) instead of the
 * legacy "process trail above answer body" layout.
 *
 * Default **false** for dogfood rollout. Flag off + text steps in DB: skip text
 * in the timeline (legacy content body only) — no dual render.
 *
 * Flip to true once dogfood is green; eventual default-on is a follow-up.
 */
export const TRANSCRIPT_INTERLEAVED_BLOCKS = false

/**
 * Virtualize the mounted transcript window (PR-7c / D3b).
 *
 * Layers on PR-7b windowing (N=30 + load earlier + jump ensure-mount).
 * Uses @tanstack/react-virtual with measureElement (variable height) when true.
 *
 * Default **false** until dogfood proves stable — windowing remains the primary
 * long-list strategy. Flip on once jump / pin-bottom / streaming remeasure are green.
 */
export const TRANSCRIPT_VIRTUALIZE = false

/** Tailwind `gap-5` = 1.25rem = 20px between message rows. */
export const TRANSCRIPT_ROW_GAP_PX = 20

/** Initial height estimate before measureElement / ResizeObserver. */
export const TRANSCRIPT_ROW_ESTIMATE_PX = 120
