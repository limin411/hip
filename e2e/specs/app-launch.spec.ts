import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'

// NewConversation now renders a fixed chat greeting instead of cycling through
// the historical variant list in `chat.greeting`.
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

    // After login, surface may restore a prior session; open a draft if needed.
    const landing = await browser.$('[data-testid="new-conversation"]')
    if (!(await landing.isExisting())) {
      const newBtn = await browser.$('[data-testid="new-session-button"]')
      if (await newBtn.isExisting()) {
        await browser.execute((el: HTMLElement) => el.click(), newBtn)
      }
    }
    await landing.waitForExist({ timeout: 30000 })
    // WebKit isDisplayed can flake under unfocused Tauri; existence + greeting is enough.

    const greeting = await landing.$('h1')
    // Wait for the animated greeting text to settle rather than relying on
    // WebKit's visibility check, which can report false when CSS animations are
    // throttled in the unfocused Tauri window.
    await browser.waitUntil(
      async () => {
        const text = await greeting.getText()
        return text.includes(CHAT_GREETING)
      },
      { timeout: 10000, interval: 200 }
    )
    const greetingText = await greeting.getText()
    expect(greetingText).toContain(CHAT_GREETING)

    const newSessionBtn = await browser.$('[data-testid="new-session-button"]')
    await newSessionBtn.waitForDisplayed({ timeout: 10000 })
  })
})
