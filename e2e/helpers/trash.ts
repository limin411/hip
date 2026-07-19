import { openTrashPageForE2e, waitForHipE2E } from './e2e-hooks.js'

/** Open product Recycle Bin via DEV store bridge. */
export async function openTrash(): Promise<void> {
  await waitForHipE2E()
  await openTrashPageForE2e()
  await (await browser.$('[data-testid="recycle-bin-page"]')).waitForExist({ timeout: 15000 })
}

/** Leave recycle bin via chats nav. */
export async function closeTrash(): Promise<void> {
  if (!(await (await browser.$('[data-testid="recycle-bin-page"]')).isExisting())) return
  const nav = await browser.$('[data-testid="sidebar-nav-chats"]')
  if (await nav.isExisting()) {
    await browser.execute((el: HTMLElement) => el.click(), nav)
  }
  await browser.waitUntil(
    async () => !(await (await browser.$('[data-testid="recycle-bin-page"]')).isExisting()),
    { timeout: 10000, interval: 200 },
  )
}
