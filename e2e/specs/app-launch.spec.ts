import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { switchToChatSurface } from '../helpers/surface.js'

// NewConversation greeting (chat surface). Code surface uses a different string + folder picker.
const CHAT_GREETING = '我们来做点什么？'

describe('hip desktop app @smoke', () => {
  it('should launch and show the login screen', async () => {
    await waitForAppReady()

    // Tauri WebView localStorage persists across app restarts, so a previous
    // test run may have left the user already logged in. Reset auth state to
    // guarantee the login screen is shown.
    await browser.execute(() => localStorage.removeItem('hip.authed'))
    await browser.refresh()

    await browser.waitUntil(
      async () => (await browser.getUrl()).includes('#/login'),
      { timeout: 30000, interval: 500 }
    )

    const heading = await browser.$('h1')
    await heading.waitForDisplayed({ timeout: 10000 })

    const text = await heading.getText()
    expect(text).toContain('登录到 hip')
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
