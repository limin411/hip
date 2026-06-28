export async function switchToCodeSurface(): Promise<void> {
  const codeBtn = await browser.$('[data-testid="rail-code"]')
  await codeBtn.waitForClickable({ timeout: 20000 })
  await codeBtn.click()
  await (await browser.$('[data-testid="new-conversation"]')).waitForExist({ timeout: 60000 })
}

export async function switchToChatSurface(): Promise<void> {
  const chatBtn = await browser.$('[data-testid="rail-chat"]')
  await chatBtn.waitForClickable({ timeout: 20000 })
  await chatBtn.click()
}
