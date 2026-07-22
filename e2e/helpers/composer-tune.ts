/**
 * Expand collapsed ActivityBar process trail if present.
 * (Formerly also opened the Tune popover; Tune was removed.)
 */
export async function expandActivityTrailIfCollapsed(): Promise<void> {
  const summary = await browser.$('[data-testid="activity-bar-summary"]')
  if (!(await summary.isExisting())) return
  const tag = await summary.getTagName()
  if (tag.toLowerCase() !== 'button') return
  const expanded = await summary.getAttribute('aria-expanded')
  if (expanded === 'true') return
  await browser.execute((el: HTMLElement) => el.click(), summary)
  await browser.pause(150)
}
