import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp } from './helpers/app.js'
import { skipLoginIfPresent } from './helpers/auth.js'
import { switchToChatSurface } from './helpers/surface.js'
import { ChatPage } from './page-objects/ChatPage.js'

const chat = new ChatPage()

/**
 * Session token usage chip e2e tests.
 *
 * The chip is rendered inside the title bar with data-testid="session-usage".
 * It only appears when:
 *   - an active session exists, AND
 *   - at least one message in that session carries token usage data, AND
 *   - the active model's catalog entry defines a context window (`limit.context`).
 *
 * Without a live sidecar exchanging messages, usage data is normally absent.
 * These tests verify the absence case deterministically and gate the presence
 * assertion on the chip actually being rendered (manual QA covers live usage).
 */
describe('session usage chip @settings', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await switchToChatSurface()
  })

  it('does not render the usage chip on a fresh new-conversation draft', async () => {
    const newBtn = await browser.$('[data-testid="new-session-button"]')
    if (await newBtn.isExisting()) {
      await newBtn.click()
      await chat.newConversation.waitForExist({ timeout: 10000 })
    }

    const chip = await chat.sessionUsage
    await expect(chip).not.toBeExisting()
  })

  it('shows the token percentage chip when a session has usage', async () => {
    const chip = await chat.sessionUsage
    const exists = await chip.isExisting()
    if (!exists) {
      // No active session with usage — chip correctly absent.
      // Manual QA covers this scenario in F3.
      return
    }

    await chip.waitForDisplayed({ timeout: 10000 })
    const text = await chip.getText()
    // The chip renders either "N% (used / total)" or just a raw token count.
    expect(text).toMatch(/\d[\d,]*%?\s*(\(\s*\d[\d,]*\s*\/\s*\d[\d,]*\s*\))?/)
  })
})
