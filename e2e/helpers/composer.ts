export async function sendComposerMessage(text: string): Promise<void> {
  const ta = await browser.$('[data-testid="new-conversation"] textarea')
  await ta.click()
  await browser.keys(text)
  const send = await browser.$('[data-testid="new-conversation"] [data-testid="composer-send"]')
  await send.waitForEnabled({ timeout: 10000 })
  await send.click()
}
