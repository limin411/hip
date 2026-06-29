export async function switchToCodeSurface(): Promise<void> {
  // The sidebar (and its surface tabs) only render after the providers catalog has loaded.
  await (await browser.$('[data-testid="sidebar-root"]')).waitForExist({ timeout: 30000 })

  // If a previous spec left an active session open, start a fresh conversation
  // before switching to the code surface.
  const newConversation = await browser.$('[data-testid="new-conversation"]')
  if (!(await newConversation.isExisting())) {
    const newSession = await browser.$('[data-testid="new-session-button"]')
    await newSession.waitForClickable({ timeout: 10000 })
    await newSession.click()
    await newConversation.waitForExist({ timeout: 30000 })
  }

  const codeBtn = await browser.$('[data-testid="surface-tab-code"]')
  await codeBtn.waitForClickable({ timeout: 20000 })
  await codeBtn.click()
  // Re-query after the surface switch because the DOM may have been recreated.
  await (await browser.$('[data-testid="new-conversation"]')).waitForExist({ timeout: 60000 })
}

export async function switchToChatSurface(): Promise<void> {
  const chatBtn = await browser.$('[data-testid="surface-tab-chat"]')
  await chatBtn.waitForClickable({ timeout: 20000 })
  await chatBtn.click()
}
