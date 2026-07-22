/**
 * Shared focus geometry families (visual craft elevation KD-2).
 * Allowlist only — do not invent new focus ring dialects at call sites.
 */

/** Text fields: soft accent border + glow. */
export const focusField =
  'focus-visible:outline-none focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent/10'

/** Multi-control field wrappers (e.g. composer card shell). */
export const focusFieldWithin =
  'focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent/10'

/** Icon buttons, list rows, tabs, chips, segmented, titlebar, Switch. */
export const focusChrome =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20'
