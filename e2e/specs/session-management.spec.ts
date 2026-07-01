import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { sendChatMessage } from '../helpers/session.js'
import { switchToChatSurface } from '../helpers/surface.js'
import { ChatPage } from '../page-objects/ChatPage.js'

const chat = new ChatPage()

async function ensureNewConversationDraft(): Promise<void> {
  const newConversation = await chat.newConversation
  if (!(await newConversation.isExisting())) {
    const newBtn = await browser.$('[data-testid="new-session-button"]')
    await newBtn.waitForClickable({ timeout: 10000 })
    await newBtn.click()
    await newConversation.waitForExist({ timeout: 10000 })
  }
}

async function clearSessionSearch(): Promise<void> {
  const input = await browser.$('[data-testid="session-search-input"]')
  if (await input.isExisting()) {
    await input.setValue('')
  }
}

describe('session management', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    // Earlier specs may have left the app on the code surface. Chat-mode
    // sessions must not require a project folder before sending.
    await switchToChatSurface()
  })

  beforeEach(async () => {
    await switchToChatSurface()
    await ensureNewConversationDraft()
    await clearSessionSearch()
  })

  it('creates a new conversation draft from the sidebar', async () => {
    const newBtn = await browser.$('[data-testid="new-session-button"]')
    await newBtn.waitForClickable({ timeout: 10000 })
    await newBtn.click()
    await chat.newConversation.waitForExist({ timeout: 10000 })
  })

  it('commits a chat session by sending a message', async () => {
    const before = await (await chat.sessionItems).length
    await sendChatMessage('hello e2e')
    await browser.waitUntil(
      async () => await (await chat.sessionItems).length === before + 1,
      { timeout: 30000, interval: 500 },
    )
    const bubble = await browser.$('//*[@data-message-id][contains(., "hello e2e")]')
    await bubble.waitForExist({ timeout: 10000 })
    expect(await bubble.getText()).toContain('hello e2e')
  })

  it('switches between sessions by clicking session items', async () => {
    await sendChatMessage('second session')
    await browser.waitUntil(
      async () => await (await chat.sessionItems).length >= 2,
      { timeout: 30000, interval: 500 },
    )
    const items = await chat.sessionItems
    const first = items[0]
    await first.click()
    const active = await browser.$('[data-testid="session-item"][data-active="true"]')
    await active.waitForExist({ timeout: 10000 })
    expect(await active.getText()).toContain('second session')
  })

  it('filters sessions via the search box', async () => {
    // Make sure at least one session contains the search term from earlier tests.
    await sendChatMessage('e2e search target')
    await browser.waitUntil(
      async () => await (await chat.sessionItems).length >= 1,
      { timeout: 30000, interval: 500 },
    )

    const search = await browser.$('[data-testid="session-search-input"]')
    await search.click()
    await search.clearValue()
    await browser.keys('e2e')
    await browser.pause(600)

    const items = await chat.sessionItems
    expect(await items.length).toBeGreaterThanOrEqual(1)
    for (const item of items) {
      expect(await item.getText()).toMatch(/e2e/i)
    }
  })

  it('clears the search filter and shows all chat sessions again', async () => {
    const search = await browser.$('[data-testid="session-search-input"]')
    await search.setValue('e2e')
    await browser.pause(600)
    const filtered = await (await chat.sessionItems).length

    await search.setValue('')
    await browser.pause(600)
    const all = await (await chat.sessionItems).length

    expect(all).toBeGreaterThanOrEqual(filtered)
  })
})
