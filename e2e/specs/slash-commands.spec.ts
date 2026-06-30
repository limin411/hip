import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { sendComposerMessage } from '../helpers/composer.js'
import { switchToChatSurface } from '../helpers/surface.js'
import { ChatPage } from '../page-objects/ChatPage.js'

let chat: ChatPage

describe('slash commands', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    chat = new ChatPage()
  })

  before(async () => {
    // Earlier specs may have left an active session or the code surface. Force
    // a chat-mode new draft so the slash-command tests run against the
    // NewConversation surface and can send without a project folder.
    await switchToChatSurface()
    const newBtn = await browser.$('[data-testid="new-session-button"]')
    if (await newBtn.isExisting()) {
      await newBtn.click()
      await chat.newConversation.waitForExist({ timeout: 10000 })
    }
    await sendComposerMessage('/help')
    await browser.pause(2500)
  })

  it('shows palette when / is typed in session view', async () => {
    const ta = await chat.activeTextarea
    await ta.click()
    await browser.keys('/')
    await browser.pause(600)

    await expect(chat.slashPalette).toBeDisplayed()
    await expect(chat.slashCmd('help')).toBeDisplayed()
  })

  it('hides palette for normal text', async () => {
    const ta = await chat.activeTextarea
    await ta.click()
    await ta.setValue('hello')
    await browser.pause(600)

    await expect(chat.slashPalette).not.toBeDisplayed()
  })
})
