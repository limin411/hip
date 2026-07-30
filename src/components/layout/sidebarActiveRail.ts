/**
 * Active sidebar / settings-nav row: quiet surface lift + thin accent rail (no ring/border).
 * Matches SettingsPanel Tabs triggers: bg-state-hover + left accent bar.
 * Rail is slightly inset and full-rounded so it reads as a signal, not a bar chart.
 */
export const SIDEBAR_ACTIVE_RAIL =
  'relative bg-state-hover text-ink before:absolute before:inset-y-1.5 before:left-0 before:w-[2px] before:rounded-full before:bg-accent before:opacity-100 before:transition-opacity before:duration-chrome before:ease-out'
