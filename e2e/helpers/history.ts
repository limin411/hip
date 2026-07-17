import { openHistoryPageForE2e, waitForHipE2E } from './e2e-hooks.js'

/** Open Session History via DEV store bridge (sidebar has no account history menu). */
export async function openHistory(): Promise<void> {
  await waitForHipE2E()
  await openHistoryPageForE2e()
  await (await browser.$('[data-testid="session-history"]')).waitForExist({ timeout: 15000 })
}

/** Leave history via sidebar (toolbar has no back button). */
export async function closeHistory(): Promise<void> {
  if (!(await (await browser.$('[data-testid="session-history"]')).isExisting())) return
  const nav = await browser.$('[data-testid="sidebar-nav-chats"]')
  if (await nav.isExisting()) {
    await browser.execute((el: HTMLElement) => el.click(), nav)
  }
  await browser.waitUntil(async () => !(await (await browser.$('[data-testid="session-history"]')).isExisting()), {
    timeout: 10000,
    interval: 200,
  })
}
