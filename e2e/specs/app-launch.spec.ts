import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { switchToChatSurface } from '../helpers/surface.js'

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

    // Greeting is time/locale/LLM-dynamic (emptyGreeting); only require a non-empty H1.
    const greeting = await landing.$('h1')
    await greeting.waitForExist({ timeout: 15000 })
    await browser.waitUntil(
      async () => {
        const text = (await greeting.getText()).trim()
        return text.length > 0
      },
      { timeout: 15000, interval: 200, timeoutMsg: 'new-conversation h1 greeting empty' },
    )
    expect((await greeting.getText()).trim().length).toBeGreaterThan(0)

    // Product chrome: sidebar "new chat" (legacy new-session-button dropdown removed).
    const newSessionBtn = await browser.$('[data-testid="sidebar-new-chat-list"]')
    await newSessionBtn.waitForExist({ timeout: 10000 })
  })
})
