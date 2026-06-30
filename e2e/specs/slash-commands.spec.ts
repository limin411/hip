import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { ChatPage } from '../page-objects/ChatPage.js'

let chat: ChatPage

describe('slash commands', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    chat = new ChatPage()
  })

  it('Escape dismisses palette and clears slash prefix', async () => {
    const ta = await chat.activeTextarea
    await ta.click()
    await browser.keys(['/'])
    await browser.pause(300)

    const palette = await chat.slashPalette
    await expect(palette).toBeDisplayed()

    await browser.keys(['Escape'])
    await browser.pause(300)

    await expect(palette).not.toBeDisplayed()
    await expect(ta).toHaveValue('')
  })
})
