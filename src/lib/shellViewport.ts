/** Overlay shell kinds that share the same viewport sizing formulas. */
export type ShellKind = 'history' | 'trash' | 'settings'

/** Viewport presentation tier (A = floating, D = fill client). */
export type ViewportTier = 'A' | 'B' | 'C' | 'D'

export type Size = { width: number; height: number }

/** Preferred minimum shell size; reduced when viewport max is smaller. */
export const FLOOR: Size = { width: 480, height: 360 }

/** Clamp `v` into [min, max]. If max < min, returns max (degenerate viewport). */
export function clampNum(min: number, v: number, max: number): number {
  if (max < min) return max
  return Math.max(min, Math.min(v, max))
}

/**
 * Classify viewport into presentation tiers D → C → B → A.
 * - D: fill client (W < 720 or H < 560)
 * - C: near-full sheet (W < 1000 or H < 700)
 * - B: larger share (W < 1280 or H < 800)
 * - A: floating centered (else)
 */
export function classifyTier(w: number, h: number): ViewportTier {
  if (w < 720 || h < 560) return 'D'
  if (w < 1000 || h < 700) return 'C'
  if (w < 1280 || h < 800) return 'B'
  return 'A'
}

/** Horizontal / vertical margin per side for the active tier. */
export function gutters(w: number, h: number): { gx: number; gy: number } {
  if (w < 720 || h < 560) return { gx: 4, gy: 4 }
  if (w < 1000 || h < 700) return { gx: 10, gy: 10 }
  if (w < 1280 || h < 800) return { gx: 24, gy: 20 }
  return {
    gx: Math.round(clampNum(32, 0.04 * w, 64)),
    gy: Math.round(clampNum(28, 0.04 * h, 56)),
  }
}

/**
 * Ideal shell size for `kind` on a viewport of `w`×`h`, clamped to gutters + floor.
 * Settings uses a slightly larger ideal than history/trash.
 */
export function shellSize(
  w: number,
  h: number,
  kind: ShellKind = 'settings',
): Size {
  const { gx, gy } = gutters(w, h)
  const maxW = Math.max(0, w - 2 * gx)
  const maxH = Math.max(0, h - 2 * gy)
  const idealW =
    kind === 'settings' ? Math.min(1100, 0.62 * w) : Math.min(960, 0.55 * w)
  const idealH =
    kind === 'settings' ? Math.min(780, 0.72 * h) : Math.min(720, 0.68 * h)
  const minW = Math.min(FLOOR.width, maxW)
  const minH = Math.min(FLOOR.height, maxH)
  return {
    width: Math.round(clampNum(minW, idealW, maxW)),
    height: Math.round(clampNum(minH, idealH, maxH)),
  }
}

/** Clamp an arbitrary size into the shell max/min box for the current viewport. */
export function clampSizeToViewport(size: Size, w: number, h: number): Size {
  const { gx, gy } = gutters(w, h)
  const maxW = Math.max(0, w - 2 * gx)
  const maxH = Math.max(0, h - 2 * gy)
  const minW = Math.min(FLOOR.width, maxW)
  const minH = Math.min(FLOOR.height, maxH)
  return {
    width: Math.round(clampNum(minW, size.width, maxW)),
    height: Math.round(clampNum(minH, size.height, maxH)),
  }
}
