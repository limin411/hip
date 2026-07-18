import { ChatPage } from '../page-objects/ChatPage.js'

const chat = new ChatPage()

export async function sendChatMessage(text: string): Promise<void> {
  // Target the new-conversation composer explicitly; using the first <textarea>
  // on the page races with an existing session's InputBar when specs run
  // sequentially against the same app instance.
  const ta = await chat.composerTextarea
  await ta.waitForExist({ timeout: 10000 })
  await ta.click()
  await ta.clearValue()
  await browser.keys(text)
  const send = await chat.composerSend
  await send.waitForEnabled({ timeout: 10000 })
  await send.click()
}

export async function activeSessionTitle(): Promise<string> {
  const active = await browser.$('[data-session-tab="true"][aria-selected="true"]')
  await active.waitForExist({ timeout: 10000 })
  const title = await active.$('span.truncate')
  return title.getText()
}
