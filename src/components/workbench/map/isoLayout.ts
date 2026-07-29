import type { ZoneId } from '../workbenchTypes'

/**
 * Isometric cell step (screen px).
 * Neighbor centers are (ISO_TW/2, ISO_TH/2) apart — keep these large enough
 * that ~90px mascots don't stack on top of each other.
 */
export const ISO_TW = 260
export const ISO_TH = 150

/**
 * Grid cells with a gap column/row between neighbors so the 6 farmers
 * read as a roomy diamond field rather than a packed 2×3 cluster.
 *
 *   (0,0) sessions     (2,0) tasks      (4,0) automations
 *         (1,2) knowledge   (3,2) terminals
 *                  (2,4) workflows
 */
export const ZONE_CELL: Record<ZoneId, { col: number; row: number }> = {
  sessions: { col: 0, row: 0 },
  tasks: { col: 2, row: 0 },
  automations: { col: 4, row: 0 },
  knowledge: { col: 1, row: 2 },
  terminals: { col: 3, row: 2 },
  workflows: { col: 2, row: 4 },
}

export function isoProject(col: number, row: number): { x: number; y: number } {
  return {
    x: (col - row) * (ISO_TW / 2),
    y: (col + row) * (ISO_TH / 2),
  }
}

/** Bounding box for a set of cells (for centering the map). */
export function isoBounds(cells: Array<{ col: number; row: number }>): {
  minX: number
  maxX: number
  minY: number
  maxY: number
  width: number
  height: number
} {
  if (cells.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: ISO_TW, height: ISO_TH }
  }
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const c of cells) {
    const p = isoProject(c.col, c.row)
    // hit-box half-width + mascot/sign headroom
    minX = Math.min(minX, p.x - ISO_TW / 2)
    maxX = Math.max(maxX, p.x + ISO_TW / 2)
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y + ISO_TH + 140)
  }
  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  }
}
