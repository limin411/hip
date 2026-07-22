/**
 * Transcript interleaved TurnBlocks (PR-5 / KD-2).
 *
 * When true, assistant turns with `kind:'text'` timeline steps render a single
 * global stepSeq stream (reasoning / supervisor text / tool) instead of the
 * legacy "process trail above answer body" layout.
 *
 * Default **true** (Phase 5 product default). Flag off + text steps in DB: skip
 * text in the timeline (legacy content body only) — no dual render.
 *
 * ACP / turns without renderable supervisor text steps keep the legacy body
 * via `hasRenderableSupervisorText` (see MessageBubble).
 */
export const TRANSCRIPT_INTERLEAVED_BLOCKS = true

/**
 * Virtualize the mounted transcript window (PR-7c / D3b).
 *
 * Layers on PR-7b windowing (N=30 + load earlier + jump ensure-mount).
 * Uses @tanstack/react-virtual with measureElement (variable height) when true.
 *
 * Default **true** (Phase 5 product default). Windowing remains the primary
 * long-list strategy; virtualization only mounts the visible overscan slice.
 */
export const TRANSCRIPT_VIRTUALIZE = true

/** Tailwind `gap-5` = 1.25rem = 20px between message rows. */
export const TRANSCRIPT_ROW_GAP_PX = 20

/** Initial height estimate before measureElement / ResizeObserver. */
export const TRANSCRIPT_ROW_ESTIMATE_PX = 120
