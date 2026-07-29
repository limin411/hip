import { describe, it, expect } from 'vitest'
import { isoBounds, isoProject, ISO_TW } from './isoLayout'

describe('isoLayout', () => {
  it('projects col/row to isometric screen coords', () => {
    expect(isoProject(0, 0)).toEqual({ x: 0, y: 0 })
    const p = isoProject(1, 0)
    expect(p.x).toBe(ISO_TW / 2)
    expect(p.y).toBeGreaterThan(0)
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
