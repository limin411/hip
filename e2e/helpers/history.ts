/** Open Session History via the floating account menu. */
export async function openHistory(): Promise<void> {
  const button = await browser.$('[data-testid="account-menu-button"]')
  await button.waitForExist({ timeout: 10000 })
  await browser.execute((el: HTMLElement) => el.click(), button)
  const item = await browser.$('[data-testid="account-history-menu-item"]')
  await item.waitForExist({ timeout: 10000 })
  await browser.execute((el: HTMLElement) => el.click(), item)
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
