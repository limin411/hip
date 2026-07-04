async function dismissSlashPalette(): Promise<void> {
  const palette = await browser.$('[data-testid="slash-palette"]')
  if (await palette.isExisting()) {
    await browser.keys('Escape')
    await palette.waitForExist({ reverse: true, timeout: 5000 })
  }
}

async function openNewSessionMenu(): Promise<void> {
  const button = await browser.$('[data-testid="new-session-button"]')
  await button.waitForExist({ timeout: 20000 })
  // Headless WebKit sometimes reports the button as not clickable when an
  // overlay or animation is present; use a synthetic click to bypass hit-testing.
  await browser.execute((el: HTMLElement) => el.click(), button)
}

async function clickMenuItem(label: string): Promise<void> {
  const item = await browser.$(`//div[@role="menuitem"][contains(., "${label}")]`)
  await item.waitForExist({ timeout: 10000 })
  await browser.execute((el: HTMLElement) => el.click(), item)
}

async function switchToSurface(surface: 'chat' | 'code'): Promise<void> {
  await dismissSlashPalette()
  await openNewSessionMenu()

  const label = surface === 'code' ? 'New Code' : 'New Chat'
  await clickMenuItem(label)

  // Re-query after the surface switch because the DOM may have been recreated.
  await (await browser.$('[data-testid="new-conversation"]')).waitForExist({ timeout: 60000 })
}

export async function switchToCodeSurface(): Promise<void> {
  await switchToSurface('code')
}

export async function switchToChatSurface(): Promise<void> {
  await switchToSurface('chat')
}
