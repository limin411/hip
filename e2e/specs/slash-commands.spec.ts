import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { switchToChatSurface, switchToCodeSurface } from '../helpers/surface.js'
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

describe('slash commands @core', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    chat = new ChatPage()
  })

  beforeEach(async () => {
    // Each test starts from a clean chat-mode new-conversation draft so the
    // palette contents are deterministic and no project folder is required.
    await switchToChatSurface()
    await ensureNewConversationDraft()
  })

  it('shows the palette when / is typed and lists chat-safe commands', async () => {
    await typeInComposer('/')
    await browser.pause(600)

    await expect(chat.slashPalette).toBeDisplayed()
    await expect(chat.slashCmd('help')).toBeDisplayed()
    await expect(chat.slashCmd('clear')).toBeDisplayed()
    await expect(chat.slashCmd('config')).toBeDisplayed()
  })

  it('filters the palette while typing', async () => {
    await typeInComposer('/h')
    await browser.pause(600)

    await expect(chat.slashPalette).toBeDisplayed()
    await expect(chat.slashCmd('help')).toBeDisplayed()
    await expect(chat.slashCmd('clear')).not.toBeExisting()
  })

  it('hides the palette when the slash is replaced by normal text', async () => {
    await typeInComposer('/')
    await browser.pause(600)
    await expect(chat.slashPalette).toBeDisplayed()

    // Replace the slash command with plain text; the palette should unmount.
    const ta = await chat.activeTextarea
    await ta.setValue('hello')
    await browser.pause(600)

    const palette = await chat.slashPalette
    if (await palette.isExisting()) {
      expect(await palette.isDisplayed()).toBe(false)
    }
  })

  it('hides code-only commands in the chat surface', async () => {
    await typeInComposer('/')
    await browser.pause(600)

    await expect(chat.slashCmd('diff')).not.toBeExisting()
    await expect(chat.slashCmd('init')).not.toBeExisting()
    await expect(chat.slashCmd('compact')).not.toBeExisting()
  })

  it('shows code-only commands on the code surface when there is no active session', async () => {
    await switchToCodeSurface()
    await ensureNewConversationDraft()

    await typeInComposer('/')
    await browser.pause(600)

    await expect(chat.slashPalette).toBeDisplayed()
    await expect(chat.slashCmd('diff')).toBeDisplayed()
    await expect(chat.slashCmd('init')).toBeDisplayed()
    // /compact requires an active session, so it is hidden on a new draft.
    await expect(chat.slashCmd('compact')).not.toBeExisting()
  })
})
