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

export async function closeHistory(): Promise<void> {
  const back = await browser.$('[data-testid="titlebar-back"]')
  if (!(await back.isExisting())) return
  await browser.execute((el: HTMLElement) => el.click(), back)
  await browser.waitUntil(async () => !(await (await browser.$('[data-testid="session-history"]')).isExisting()), {
    timeout: 10000,
    interval: 200,
  })
}
