/**
 * Active sidebar / settings-nav row: quiet surface lift only (no left rail / accent bar).
 * Selected state is the background wash; status dots (running etc.) stay on the row itself.
 * Light: solid white — an opaque card that lifts off the frosted-glass sidebar
 * (#F6F5F3 @ 68% + blur), so selection stays visible regardless of what the
 * wallpaper shows through. Dark: keep state-active (deeper than hover) so the
 * wash still reads on bg-surface-subtle.
 */
export const SIDEBAR_ACTIVE_RAIL = 'relative bg-white text-ink dark:bg-state-active'
