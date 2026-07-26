/**
 * Shared focus geometry families (visual craft elevation KD-2).
 * Allowlist only — do not invent new focus ring dialects at call sites.
 */

/** Text fields: kill browser outline only — no tinted border/ring (clean chrome). */
export const focusField = 'focus-visible:outline-none'

/** Multi-control field wrappers (e.g. composer card shell): no focus chrome. */
export const focusFieldWithin = ''

/** Icon buttons, list rows, tabs, chips, segmented, titlebar, Switch. */
export const focusChrome =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20'
