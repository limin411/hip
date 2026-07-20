/**
 * Simple end-anchored transcript window (PR-7b / KD-15).
 * Mount the last N messages; "Load earlier" grows the window.
 * Not virtualization — just DOM mount range.
 */

/** Default number of messages mounted at the end of the transcript (KD-15). */
export const TRANSCRIPT_WINDOW_SIZE = 30

/** Index of first mounted message when showing `windowSize` messages from the end. */
export function transcriptWindowStart(total: number, windowSize: number): number {
  return Math.max(0, total - Math.max(0, windowSize))
}

/**
 * Window size needed so `targetIndex` is included (window still anchored at the end).
 * Used by jump: expand until the target is mounted, then scroll + highlight.
 */
export function windowSizeToInclude(total: number, targetIndex: number): number {
  if (total <= 0 || targetIndex < 0 || targetIndex >= total) {
    return TRANSCRIPT_WINDOW_SIZE
  }
  return Math.max(TRANSCRIPT_WINDOW_SIZE, total - targetIndex)
}

/** Next window size after "Load earlier" (grow by step, cap at total). */
export function growWindowSize(
  total: number,
  current: number,
  step: number = TRANSCRIPT_WINDOW_SIZE,
): number {
  return Math.min(total, Math.max(0, current) + Math.max(0, step))
}
