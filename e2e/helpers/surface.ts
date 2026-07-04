async function ensureNewConversationLanding(): Promise<void> {
  const newConversation = await browser.$('[data-testid="new-conversation"]')
  if (!(await newConversation.isExisting())) {
    const newSession = await browser.$('[data-testid="new-session-button"]')
    await newSession.waitForExist({ timeout: 10000 })
    await browser.execute((el: HTMLElement) => el.click(), newSession)
  }
  await (await browser.$('[data-testid="new-conversation"]')).waitForExist({ timeout: 60000 })

  // Dismiss any leftover slash-palette overlay from a previous spec; otherwise it
  // intercepts clicks on the surface toggle in headless WebKit.
  const palette = await browser.$('[data-testid="slash-palette"]')
  if (await palette.isExisting()) {
    await browser.keys('Escape')
    await palette.waitForExist({ reverse: true, timeout: 5000 })
  }
}

async function clickSurfaceToggle(testid: 'surface-toggle-code' | 'surface-toggle-chat'): Promise<void> {
  const btn = await browser.$(`[data-testid="${testid}"]`)
  await btn.waitForExist({ timeout: 20000 })
  const pressed = await btn.getAttribute('aria-pressed')
  if (pressed === 'true') return
  // Headless WebKit sometimes reports the toggle as not clickable when an
  // overlay or animation is present; use a synthetic click to bypass hit-testing.
  await browser.execute((el: HTMLElement) => el.click(), btn)
}

export async function switchToCodeSurface(): Promise<void> {
  await ensureNewConversationLanding()
  await clickSurfaceToggle('surface-toggle-code')

  // Re-query after the surface switch because the DOM may have been recreated.
  await (await browser.$('[data-testid="new-conversation"]')).waitForExist({ timeout: 60000 })
}

export async function switchToChatSurface(): Promise<void> {
  await ensureNewConversationLanding()
  await clickSurfaceToggle('surface-toggle-chat')
}
