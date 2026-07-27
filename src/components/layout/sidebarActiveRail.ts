/**
 * Active sidebar row: quiet surface lift + thin Sage rail (no ring/border).
 * Rail is slightly inset and full-rounded so it reads as a signal, not a bar chart.
 * before: uses scaleY so active/inactive transitions feel continuous when rows share the class.
 */
export const SIDEBAR_ACTIVE_RAIL =
  'relative bg-state-hover text-ink before:absolute before:inset-y-1.5 before:left-0 before:w-[2px] before:origin-center before:scale-y-100 before:rounded-full before:bg-accent before:transition-transform before:duration-chrome before:ease-out'
