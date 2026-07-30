import { describe, it, expect } from 'vitest'
import {
  classifyTier,
  gutters,
  shellSize,
  clampNum,
  clampSizeToViewport,
  FLOOR,
  type ShellKind,
  type ViewportTier,
  type Size,
} from './shellViewport'

describe('clampNum', () => {
  it('clamps into [min, max]', () => {
    expect(clampNum(0, -1, 10)).toBe(0)
    expect(clampNum(0, 5, 10)).toBe(5)
    expect(clampNum(0, 15, 10)).toBe(10)
  })

  it('returns max when max < min (degenerate)', () => {
    expect(clampNum(10, 5, 3)).toBe(3)
  })
})

describe('classifyTier', () => {
  const cases: { w: number; h: number; tier: ViewportTier; label: string }[] = [
    { w: 719, h: 559, tier: 'D', label: '719×559 → D' },
    { w: 720, h: 560, tier: 'C', label: '720×560 → C' },
    { w: 999, h: 800, tier: 'C', label: '999×800 → C' },
    { w: 1000, h: 700, tier: 'B', label: '1000×700 → B' },
    { w: 1280, h: 800, tier: 'A', label: '1280×800 → A' },
    { w: 600, h: 500, tier: 'D', label: '600×500 → D' },
    // single-axis triggers
    { w: 719, h: 900, tier: 'D', label: 'narrow W → D' },
    { w: 1400, h: 559, tier: 'D', label: 'short H → D' },
    { w: 999, h: 900, tier: 'C', label: 'W only < 1000 → C' },
    { w: 1200, h: 699, tier: 'C', label: 'H only < 700 → C' },
    { w: 1279, h: 900, tier: 'B', label: 'W only < 1280 → B' },
    { w: 1400, h: 799, tier: 'B', label: 'H only < 800 → B' },
    { w: 1920, h: 1080, tier: 'A', label: 'large → A' },
  ]

  it.each(cases)('$label', ({ w, h, tier }) => {
    expect(classifyTier(w, h)).toBe(tier)
  })
})

describe('gutters', () => {
  it('D uses 4×4', () => {
    expect(gutters(600, 500)).toEqual({ gx: 4, gy: 4 })
    expect(gutters(719, 900)).toEqual({ gx: 4, gy: 4 })
  })

  it('C uses 10×10', () => {
    expect(gutters(720, 560)).toEqual({ gx: 10, gy: 10 })
    expect(gutters(999, 800)).toEqual({ gx: 10, gy: 10 })
  })

  it('B uses 24×20', () => {
    expect(gutters(1000, 700)).toEqual({ gx: 24, gy: 20 })
    expect(gutters(1279, 900)).toEqual({ gx: 24, gy: 20 })
  })

  it('A uses 4% of viewport clamped into [32,64]×[28,56]', () => {
    // Golden: 0.04*1280=51.2 → 51, 0.04*800=32 → 32
    expect(gutters(1280, 800)).toEqual({ gx: 51, gy: 32 })
    // very large: caps at 64 / 56
    expect(gutters(2000, 2000)).toEqual({ gx: 64, gy: 56 })
    // Note: lower clamps 32/28 are unreachable on true A (W≥1280 → 4%W≥51.2;
    // H≥800 → 4%H≥32). Upper caps 64/56 are reachable. Design-as-specified.
  })
})

describe('shellSize', () => {
  function expectWithinBounds(size: Size, w: number, h: number) {
    const { gx, gy } = gutters(w, h)
    const maxW = Math.max(0, w - 2 * gx)
    const maxH = Math.max(0, h - 2 * gy)
    expect(size.width).toBeLessThanOrEqual(maxW)
    expect(size.height).toBeLessThanOrEqual(maxH)
    expect(size.width).toBeGreaterThanOrEqual(0)
    expect(size.height).toBeGreaterThanOrEqual(0)
    // no overflow of client
    expect(size.width + 2 * gx).toBeLessThanOrEqual(w)
    expect(size.height + 2 * gy).toBeLessThanOrEqual(h)
  }

  it('600×500 → D, no overflow (fills within 4px gutters)', () => {
    const size = shellSize(600, 500, 'settings')
    expectWithinBounds(size, 600, 500)
    // Golden independent of helper reimplementation
    expect(size).toEqual({ width: 480, height: 360 })
  })

  it('defaults kind to settings', () => {
    expect(shellSize(1280, 800)).toEqual(shellSize(1280, 800, 'settings'))
  })

  it('settings ideal is larger than history/trash', () => {
    const settings = shellSize(1440, 900, 'settings')
    const history = shellSize(1440, 900, 'history')
    const trash = shellSize(1440, 900, 'trash')
    expect(settings.width).toBeGreaterThanOrEqual(history.width)
    expect(settings.height).toBeGreaterThanOrEqual(history.height)
    expect(history).toEqual(trash)
  })

  const kinds: ShellKind[] = ['settings', 'history', 'trash']
  const viewports = [
    { w: 600, h: 500 },
    { w: 720, h: 560 },
    { w: 1000, h: 700 },
    { w: 1280, h: 800 },
    { w: 1920, h: 1080 },
    { w: 400, h: 300 }, // smaller than FLOOR
  ]

  it.each(
    viewports.flatMap(({ w, h }) =>
      kinds.map((kind) => ({ w, h, kind, label: `${w}×${h} ${kind}` })),
    ),
  )('$label stays within gutters and never overflows', ({ w, h, kind }) => {
    const size = shellSize(w, h, kind)
    expectWithinBounds(size, w, h)
    // integers
    expect(Number.isInteger(size.width)).toBe(true)
    expect(Number.isInteger(size.height)).toBe(true)
  })

  it('raises ideal to FLOOR when ideal < FLOOR ≤ max', () => {
    // 720×560 settings: idealW = min(1100, 0.62*720) = 446.4 → floor to 480
    // idealH = min(780, 0.72*560) = 403.2 → stays above floor height
    const size = shellSize(720, 560, 'settings')
    expect(size.width).toBe(FLOOR.width)
    expect(size.height).toBe(403)
  })

  it('drops floor when max is smaller than FLOOR', () => {
    // maxW = 400 - 8 = 392 < 480; maxH = 300 - 8 = 292 < 360
    const size = shellSize(400, 300, 'settings')
    expect(size.width).toBe(392)
    expect(size.height).toBe(292)
  })

  // Hard-coded goldens (independent of clampNum/gutters reimplementation)
  it.each([
    {
      label: '1280×800 settings',
      w: 1280,
      h: 800,
      kind: 'settings' as const,
      size: { width: 794, height: 576 },
    },
    {
      label: '1280×800 history',
      w: 1280,
      h: 800,
      kind: 'history' as const,
      size: { width: 704, height: 544 },
    },
    {
      label: '1000×700 settings',
      w: 1000,
      h: 700,
      kind: 'settings' as const,
      size: { width: 620, height: 504 },
    },
    {
      label: '1800×1100 settings',
      w: 1800,
      h: 1100,
      kind: 'settings' as const,
      size: { width: 1100, height: 780 },
    },
  ])('golden $label', ({ w, h, kind, size }) => {
    expect(shellSize(w, h, kind)).toEqual(size)
  })
})

describe('clampSizeToViewport', () => {
  it('shrinks oversized shells', () => {
    const size = clampSizeToViewport({ width: 5000, height: 5000 }, 1000, 700)
    expect(size).toEqual({
      width: 1000 - 2 * 24,
      height: 700 - 2 * 20,
    })
  })

  it('raises undersized shells to floor when space allows', () => {
    const size = clampSizeToViewport({ width: 100, height: 100 }, 1280, 800)
    expect(size).toEqual({ width: 480, height: 360 })
  })

  it('does not exceed max when floor is larger than max', () => {
    const size = clampSizeToViewport({ width: 10, height: 10 }, 400, 300)
    expect(size.width).toBe(392)
    expect(size.height).toBe(292)
  })
})

describe('FLOOR', () => {
  it('is 480×360 and frozen', () => {
    expect(FLOOR).toEqual({ width: 480, height: 360 })
    expect(Object.isFrozen(FLOOR)).toBe(true)
  })
})
