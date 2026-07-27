/** Default / clamp bounds for the left AppSidebar width (px). */
export const SIDEBAR_WIDTH_DEFAULT = 300
export const SIDEBAR_WIDTH_MIN = 200
export const SIDEBAR_WIDTH_MAX = 480

/** Keyboard step when focusing the resize separator (px). */
export const SIDEBAR_WIDTH_STEP = 16

/**
 * Clamp a raw width to [MIN, MAX]. Non-finite values fall back to default.
 * Optionally cap against a live max (e.g. half the viewport while dragging).
 */
export function clampSidebarWidth(raw: unknown, liveMax?: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return SIDEBAR_WIDTH_DEFAULT
  const ceiling =
    typeof liveMax === 'number' && Number.isFinite(liveMax)
      ? Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, liveMax))
      : SIDEBAR_WIDTH_MAX
  return Math.round(Math.min(ceiling, Math.max(SIDEBAR_WIDTH_MIN, raw)))
}
