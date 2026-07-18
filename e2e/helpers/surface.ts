/** Dismiss slash palette if open so surface switches are not blocked. */
async function dismissSlashPalette(): Promise<void> {
  const palette = await browser.$('[data-testid="slash-palette"]')
  if (await palette.isExisting()) {
    await browser.keys('Escape')
    await palette.waitForExist({ reverse: true, timeout: 5000 })
  }
}

/**
 * Switch to chat or code new-conversation surface using current sidebar chrome.
 * (Legacy new-session-button dropdown was removed; nav + new-chat/task is the product path.)
 */
async function switchToSurface(surface: 'chat' | 'code'): Promise<void> {
  await dismissSlashPalette()

  const navTestId = surface === 'code' ? 'sidebar-nav-projects' : 'sidebar-nav-chats'
  const newTestId = surface === 'code' ? 'sidebar-new-task' : 'sidebar-new-chat-list'

  const nav = await browser.$(`[data-testid="${navTestId}"]`)
  await nav.waitForExist({ timeout: 20000 })
  await browser.execute((el: HTMLElement) => el.click(), nav)
  await browser.pause(80)

  const btn = await browser.$(`[data-testid="${newTestId}"]`)
  await btn.waitForExist({ timeout: 15000 })
  await browser.execute((el: HTMLElement) => el.click(), btn)

  // Compatibility aliases used by older specs / reporters
  // (optional — buttons already have product testids)

  await (await browser.$('[data-testid="new-conversation"]')).waitForExist({ timeout: 60000 })
}

export async function switchToCodeSurface(): Promise<void> {
  await switchToSurface('code')
}

export async function switchToChatSurface(): Promise<void> {
  await switchToSurface('chat')
}
