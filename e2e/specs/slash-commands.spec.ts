import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { sendComposerMessage } from '../helpers/composer.js'
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
