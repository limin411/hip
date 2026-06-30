import { ChatPage } from '../page-objects/ChatPage.js'

const chat = new ChatPage()

export async function sendChatMessage(text: string): Promise<void> {
  const ta = await chat.activeTextarea
  await ta.click()
  await browser.keys(text)
  const send = await chat.composerSend
  await send.waitForEnabled({ timeout: 10000 })
  await send.click()
}

export async function activeSessionTitle(): Promise<string> {
  const active = await browser.$('[data-testid="session-item"][data-active="true"]')
  await active.waitForExist({ timeout: 10000 })
  const title = await active.$('span.truncate')
  return title.getText()
}
