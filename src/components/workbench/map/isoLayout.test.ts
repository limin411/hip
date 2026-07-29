import { describe, it, expect } from 'vitest'
import { isoBounds, isoProject, ISO_TH, ISO_TW, ZONE_CELL } from './isoLayout'

describe('isoLayout', () => {
  it('projects col/row to isometric screen coords', () => {
    expect(isoProject(0, 0)).toEqual({ x: 0, y: 0 })
    const p = isoProject(1, 0)
    expect(p.x).toBe(ISO_TW / 2)
    expect(p.y).toBe(ISO_TH / 2)
  })

  it('keeps adjacent zone centers far enough apart for mascots', () => {
    // Closest pair on the map should still clear ~two mascot radii (~90px).
    const cells = Object.values(ZONE_CELL)
    let minDist = Infinity
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        const a = isoProject(cells[i].col, cells[i].row)
        const b = isoProject(cells[j].col, cells[j].row)
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        minDist = Math.min(minDist, d)
      }
    }
    expect(minDist).toBeGreaterThan(180)
  })

  it('computes bounds for cells', () => {
    const b = isoBounds([
      { col: 0, row: 0 },
      { col: 1, row: 0 },
    ])
    expect(b.width).toBeGreaterThan(0)
    expect(b.height).toBeGreaterThan(0)
  })
})
