// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { clampToViewport, type Size } from './useResizableBox'

/** Modal DEFAULT_MIN — used when viewport is smaller than min. */
const DEFAULT_MIN: Size = { width: 600, height: 440 }

function setViewport(w: number, h: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: w })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: h })
}

describe('clampToViewport', () => {
  afterEach(() => {
    setViewport(1024, 768)
    vi.restoreAllMocks()
  })

  it('clamps oversized size to ~96%×92% of viewport', () => {
    setViewport(1000, 800)
    const size = clampToViewport({ width: 5000, height: 5000 }, DEFAULT_MIN)
    expect(size).toEqual({
      width: Math.round(1000 * 0.96),
      height: Math.round(800 * 0.92),
    })
  })

  it('raises undersized size to min when viewport allows', () => {
    setViewport(1280, 900)
    const size = clampToViewport({ width: 100, height: 100 }, DEFAULT_MIN)
    expect(size).toEqual(DEFAULT_MIN)
  })

  it('never lets min exceed max when viewport is smaller than DEFAULT_MIN', () => {
    // maxW = 384, maxH = 276 — both below 600×440
    setViewport(400, 300)
    const size = clampToViewport({ width: 600, height: 440 }, DEFAULT_MIN)
    expect(size.width).toBe(Math.round(400 * 0.96))
    expect(size.height).toBe(Math.round(300 * 0.92))
    // Must fit inside viewport max (no overflow stick at min)
    expect(size.width).toBeLessThanOrEqual(Math.round(400 * 0.96))
    expect(size.height).toBeLessThanOrEqual(Math.round(300 * 0.92))
    expect(size.width).toBeLessThan(DEFAULT_MIN.width)
    expect(size.height).toBeLessThan(DEFAULT_MIN.height)
  })

  it('preserves size already within bounds', () => {
    setViewport(1280, 900)
    const size = clampToViewport({ width: 800, height: 500 }, DEFAULT_MIN)
    expect(size).toEqual({ width: 800, height: 500 })
  })
})
