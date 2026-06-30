import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { sendChatMessage } from '../helpers/session.js'
import { ChatPage } from '../page-objects/ChatPage.js'

const chat = new ChatPage()

describe('session management', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
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
      async () => (await chat.sessionItems).length === before + 1,
      { timeout: 30000, interval: 500 },
    )
    const bubble = await browser.$('//*[@data-message-id][contains(., "hello e2e")]')
    await bubble.waitForExist({ timeout: 10000 })
    expect(await bubble.getText()).toContain('hello e2e')
  })

  it('switches between sessions by clicking session items', async () => {
    const newBtn = await browser.$('[data-testid="new-session-button"]')
    await newBtn.waitForClickable({ timeout: 10000 })
    await newBtn.click()
    await chat.newConversation.waitForExist({ timeout: 10000 })
    await sendChatMessage('second session')
    await browser.waitUntil(
      async () => (await chat.sessionItems).length >= 2,
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
    const search = await browser.$('[data-testid="session-search-input"]')
    await search.click()
    await browser.keys('e2e')
    await browser.pause(500)
    const items = await chat.sessionItems
    expect(items.length).toBeGreaterThanOrEqual(1)
    for (const item of items) {
      expect(await item.getText()).toMatch(/e2e/i)
    }
  })
})
