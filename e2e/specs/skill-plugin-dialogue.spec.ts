import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { switchToChatSurface } from '../helpers/surface.js'
import { ChatPage } from '../page-objects/ChatPage.js'

let chat: ChatPage

async function ensureNewConversationDraft(): Promise<void> {
  const newBtn = await browser.$('[data-testid="new-session-button"]')
  if (await newBtn.isExisting()) {
    await newBtn.click()
    await chat.newConversation.waitForExist({ timeout: 10000 })
  }
}

async function typeInComposer(text: string): Promise<void> {
  const ta = await chat.activeTextarea
  await ta.waitForExist({ timeout: 10000 })
  await ta.click()
  await ta.clearValue()
  await browser.keys(text)
}

async function waitForSkillCommand(name: string): Promise<WebdriverIO.Element> {
  const cmd = chat.slashCmd(name)
  await cmd.waitForExist({ timeout: 10000 })
  return cmd
}

async function selectSkill(name: string): Promise<void> {
  await typeInComposer('/')
  await expect(chat.slashPalette).toBeDisplayed()
  const cmd = await waitForSkillCommand(name)
  await cmd.waitForDisplayed({ timeout: 5000 })
  await cmd.click()
  await browser.pause(300)
}

describe('skill-plugin-dialogue @core', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    chat = new ChatPage()
  })

  beforeEach(async () => {
    await switchToChatSurface()
    await ensureNewConversationDraft()
  })

  it('selects /sample-greet from the slash palette and updates the composer', async () => {
    await selectSkill('sample-greet')

    const ta = await chat.activeTextarea
    await expect(ta).toHaveValue('/sample-greet ', { trim: false })
  })

  it('selects /sample-format, shows argument hints, and sends the message', async () => {
    await selectSkill('sample-format')

    const formatTa = await chat.activeTextarea
    await expect(formatTa).toHaveValue('/sample-format ', { trim: false })

    await browser.keys('src/index.ts prettier')
    await browser.pause(300)

    const fileHint = await browser.$('[data-testid="skill-arg-hint-file"]')
    await fileHint.waitForExist({ timeout: 5000 })
    await expect(fileHint).toBeDisplayed()

    const styleHint = await browser.$('[data-testid="skill-arg-hint-style"]')
    await styleHint.waitForExist({ timeout: 5000 })
    await expect(styleHint).toBeDisplayed()

    await browser.keys('Enter')
    await browser.pause(300)

    const userBubble = await browser.$('//*[@data-message-id][contains(., "/sample-format")]')
    await userBubble.waitForExist({ timeout: 10000 })
    await expect(userBubble).toBeDisplayed()
  })

  it('does not show fixture skills when typing /xyz', async () => {
    await typeInComposer('/xyz')
    await browser.pause(600)

    await expect(chat.slashCmd('sample-greet')).not.toBeExisting()
    await expect(chat.slashCmd('sample-format')).not.toBeExisting()
  })
})
