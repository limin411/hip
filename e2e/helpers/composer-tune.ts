/**
 * Secondary composer controls (permission / plan / effort / worktree) live under Tune.
 * Open the popover so e2e can reach chips that are no longer always in the dock.
 */
export async function openComposerTune(): Promise<void> {
  const panel = await browser.$('[data-testid="composer-tune-panel"]')
  if (await panel.isExisting()) return

  const tune = await browser.$('[data-testid="composer-tune"]')
  await tune.waitForExist({ timeout: 15000 })
  await browser.execute((el: HTMLElement) => {
    el.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse' }),
    )
    el.click()
  }, tune)
  await panel.waitForExist({ timeout: 10000 })
}

/** Ensure a secondary control is in the DOM (open Tune if needed). */
export async function ensureComposerSecondary(
  testId: string,
  timeoutMs = 15000,
): Promise<WebdriverIO.Element> {
  let el = await browser.$(`[data-testid="${testId}"]`)
  if (await el.isExisting()) return el
  await openComposerTune()
  el = await browser.$(`[data-testid="${testId}"]`)
  await el.waitForExist({ timeout: timeoutMs })
  return el
}

/** Expand collapsed ActivityBar process trail if present. */
export async function expandActivityTrailIfCollapsed(): Promise<void> {
  const btn = await browser.$('[data-testid="activity-bar"] button[data-testid="activity-bar-summary"], [data-testid="activity-bar-summary"]')
  // summary may be button or div when interleaved
  const summary = await browser.$('[data-testid="activity-bar-summary"]')
  if (!(await summary.isExisting())) return
  const tag = await summary.getTagName()
  if (tag.toLowerCase() !== 'button') return
  const expanded = await summary.getAttribute('aria-expanded')
  if (expanded === 'true') return
  await browser.execute((el: HTMLElement) => el.click(), summary)
  await browser.pause(150)
}
