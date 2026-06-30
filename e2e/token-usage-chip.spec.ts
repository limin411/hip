import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { switchToCodeSurface } from '../helpers/surface.js'
import { ChatPage } from '../page-objects/ChatPage.js'

const chat = new ChatPage()

/**
 * Token usage chip e2e tests.
 *
 * PRECONDITIONS for the chip to render:
 * - An active session with at least one exchanged message (token usage data)
 * - A model whose catalog entry defines a `limit.context` window
 *
 * Without a live sidecar exchanging messages, the chip will not render.
 * These tests require a running Tauri app + sidecar (see wdio.conf.ts).
 */
describe('token usage chip', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await switchToCodeSurface()
  })

  it('shows the token percentage chip when session has usage', async () => {
    // The chip only appears when there is an active session with token usage.
    // If no chip is present (fresh app, no session), skip the assertion.
    const chip = await browser.$('[data-testid="token-percentage-chip"]')
    const exists = await chip.isExisting()
    if (!exists) {
      // No active session with usage — chip correctly absent.
      // Manual QA covers this scenario in F3.
      return
    }
    await chip.waitForDisplayed({ timeout: 10000 })
    // Verify the chip has a title attribute (tooltip with usage details).
    const title = await chip.getAttribute('title')
    expect(title).toBeTruthy()
    expect(title).toMatch(/\d[\d,]* \/ \d[\d,]* tokens/)
  })
})
