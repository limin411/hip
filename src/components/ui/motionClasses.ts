/**
 * Shared motion class strings for overlays, menus, modals, and view enters.
 * Tokens live in tokens.css + tailwind.config.js (duration-chrome/content, ease-out).
 */

/** Scrim behind Dialog / command palette — fade only. */
export const overlayMotion =
  'data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out'

/**
 * Centered modal / dialog panel — scale + fade.
 * Prefer inset + m-auto centering on the panel (not left/top 50% + -translate-*),
 * so enter/exit scale never fights transform-based centering.
 */
export const modalMotion =
  'data-[state=open]:animate-modal-in data-[state=closed]:animate-modal-out'

/**
 * Dropdown / popover / context menu enter+exit.
 * Pair with `origin-[var(--radix-*-transform-origin)]` at the call site.
 */
export const menuMotion =
  'data-[state=open]:animate-menu-in data-[state=closed]:animate-menu-out'

/** Absolute / fixed pickers that mount without Radix Presence (slash, @file, wiki). */
export const floatInMotion = 'animate-menu-in'

/** Main view / settings tab content enter. */
export const viewEnterMotion = 'animate-view-enter'

/** Right edge drawer content enter. */
export const panelEnterMotion = 'animate-panel-in'
