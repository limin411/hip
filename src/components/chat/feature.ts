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
