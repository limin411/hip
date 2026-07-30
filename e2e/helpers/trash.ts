import { closeOverlayForE2e, openTrashPageForE2e, waitForHipE2E } from './e2e-hooks.js'

/** Open product Recycle Bin via DEV store bridge (overlay shell). */
export async function openTrash(): Promise<void> {
  await waitForHipE2E()
  await openTrashPageForE2e()
  await (await browser.$('[data-testid="recycle-bin-page"]')).waitForExist({ timeout: 15000 })
}

/**
 * Close Recycle Bin overlay shell.
 * Prefer closeOverlayForE2e; fallback modal-close / footer re-click.
 * Do not rely on sidebar-nav-chats alone (does not clear overlay).
 */
export async function closeTrash(): Promise<void> {
  if (!(await (await browser.$('[data-testid="recycle-bin-page"]')).isExisting())) return

  await waitForHipE2E()
  try {
    await closeOverlayForE2e()
  } catch {
    // fall through
  }

  if (await (await browser.$('[data-testid="recycle-bin-page"]')).isExisting()) {
    const shellClose = await browser.$('[data-testid="modal-close"]')
    if (await shellClose.isExisting()) {
      await browser.execute((el: HTMLElement) => el.click(), shellClose)
    } else {
      const footer = await browser.$('[data-testid="account-trash-button"]')
      if (await footer.isExisting()) {
        await browser.execute((el: HTMLElement) => el.click(), footer)
      }
    }
  }

  await browser.waitUntil(
    async () => !(await (await browser.$('[data-testid="recycle-bin-page"]')).isExisting()),
    { timeout: 10000, interval: 200 },
  )
}
