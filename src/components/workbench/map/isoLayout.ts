import type { ZoneId } from '../workbenchTypes'

/**
 * Isometric cell step (screen px).
 * Sized so plot diamonds + signs read clearly with room for a center courtyard.
 */
export const ISO_TW = 220
export const ISO_TH = 124

/**
 * Courtyard farm layout — 5 plots around an open yard, workflows at the gate.
 *
 *        (0,0) sessions   (2,0) tasks   (4,0) automations
 *        (0,2) knowledge     ★yard★     (4,2) terminals
 *                       (2,3) workflows
 *
 * Yard center ≈ (2, 1) — well, path, hero idle.
 */
export const ZONE_CELL: Record<ZoneId, { col: number; row: number }> = {
  sessions: { col: 0, row: 0 },
  tasks: { col: 2, row: 0 },
  automations: { col: 4, row: 0 },
  knowledge: { col: 0, row: 2 },
  terminals: { col: 4, row: 2 },
  workflows: { col: 2, row: 3 },
}

/** Decorative / hero anchor in the open yard (not a zone). */
export const YARD_CELL = { col: 2, row: 1 } as const

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
