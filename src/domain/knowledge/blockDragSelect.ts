/**
 * Drag-handle multi-select (doc-ux-polish-2 X2) — pure logic.
 * The handle gesture: mousedown, move > 4px arms a drag, dragging across
 * rows selects the contiguous block range, mouseup ends (click with no
 * movement still opens the block menu).
 */

/** Squared distance threshold (4px) that separates click from drag. */
export const DRAG_ARM_DIST_SQ = 16

/** True once the pointer moved > 4px (Euclidean) from the handle mousedown. */
export function isDragArmed(dx: number, dy: number): boolean {
  return dx * dx + dy * dy > DRAG_ARM_DIST_SQ
}

/**
 * Contiguous inclusive block range between `startId` and `endId` in
 * document order (the Notion "drag across rows" selection).
 * Returns [] when either endpoint is unknown.
 */
export function rangeBetween(
  blockIds: string[],
  startId: string,
  endId: string,
): string[] {
  const start = blockIds.indexOf(startId)
  const end = blockIds.indexOf(endId)
  if (start < 0 || end < 0) return []
  const [lo, hi] = start <= end ? [start, end] : [end, start]
  return blockIds.slice(lo, hi + 1)
}
