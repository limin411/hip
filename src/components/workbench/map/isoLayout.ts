import type { ZoneId } from '../workbenchTypes'

/** Isometric tile half-size (screen px). */
export const ISO_TW = 148
export const ISO_TH = 74

/** Grid cell for each zone on the 2.5D farm map. */
export const ZONE_CELL: Record<ZoneId, { col: number; row: number }> = {
  sessions: { col: 0, row: 0 },
  tasks: { col: 1, row: 0 },
  automations: { col: 2, row: 0 },
  knowledge: { col: 0, row: 1 },
  terminals: { col: 1, row: 1 },
  workflows: { col: 2, row: 1 },
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
    minX = Math.min(minX, p.x - ISO_TW / 2)
    maxX = Math.max(maxX, p.x + ISO_TW / 2)
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y + ISO_TH + 120) // mascot height headroom
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
