import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { switchToChatSurface } from '../helpers/surface.js'

// NewConversation greeting (chat surface). Code surface uses a different string + folder picker.
const CHAT_GREETING = '我们来做点什么？'

describe('hip desktop app @smoke', () => {
  it('should launch directly into the main app', async () => {
    await waitForAppReady()
    await waitForMainApp()

    const sidebar = await browser.$('[data-testid="app-sidebar"]')
    const toolbar = await browser.$('[data-testid="main-toolbar"]')
    const hasShell =
      (await sidebar.isExisting()) || (await toolbar.isExisting())
    expect(hasShell).toBe(true)
  })

  it('should navigate to the main app and render the chat landing', async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    // Persisted activeView may be code; force chat draft landing for this smoke check.
    await switchToChatSurface()

    const landing = await browser.$('[data-testid="new-conversation"]')
    await landing.waitForExist({ timeout: 30000 })

    const greeting = await landing.$('h1')
    await browser.waitUntil(
      async () => {
        const text = await greeting.getText()
        return text.includes(CHAT_GREETING)
      },
      { timeout: 15000, interval: 200 },
    )
    expect(await greeting.getText()).toContain(CHAT_GREETING)

    const newSessionBtn = await browser.$('[data-testid="new-session-button"]')
    await newSessionBtn.waitForExist({ timeout: 10000 })
  })
})
