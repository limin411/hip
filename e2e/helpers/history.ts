import { closeOverlayForE2e, openHistoryPageForE2e, waitForHipE2E } from './e2e-hooks.js'

/** Open Session History via DEV store bridge (overlay shell). */
export async function openHistory(): Promise<void> {
  await waitForHipE2E()
  await openHistoryPageForE2e()
  await (await browser.$('[data-testid="session-history"]')).waitForExist({ timeout: 15000 })
}

/**
 * Close History overlay shell.
 * Prefer closeOverlayForE2e; fallback modal-close / footer re-click.
 * Do not rely on sidebar-nav-chats alone (does not clear overlay).
 */
export async function closeHistory(): Promise<void> {
  if (!(await (await browser.$('[data-testid="session-history"]')).isExisting())) return

  await waitForHipE2E()
  try {
    await closeOverlayForE2e()
  } catch {
    // fall through
  }

  if (await (await browser.$('[data-testid="session-history"]')).isExisting()) {
    const shellClose = await browser.$(
      '[data-testid="overlay-shell-history"] ~ * [data-testid="modal-close"], [data-testid="modal-close"]',
    )
    if (await shellClose.isExisting()) {
      await browser.execute((el: HTMLElement) => el.click(), shellClose)
    } else {
      const footer = await browser.$('[data-testid="account-history-button"]')
      if (await footer.isExisting()) {
        await browser.execute((el: HTMLElement) => el.click(), footer)
      }
    }
  }

  await browser.waitUntil(
    async () => !(await (await browser.$('[data-testid="session-history"]')).isExisting()),
    { timeout: 10000, interval: 200 },
  )
}
