// Citations chip via inject harness (no LLM).
import { expect } from 'expect-webdriverio'
import { leaveSpecialViewsIfOpen, waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  createChatSessionForE2e,
  injectServerMessage,
  waitForHipE2E,
} from '../helpers/e2e-hooks.js'
import { switchToChatSurface } from '../helpers/surface.js'

describe('memory citations harness @memory @harness', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
    await waitForHipE2E()
    await switchToChatSurface()
  })

  it('M2.14 shows citations chip when assistant message has memoryCitations', async () => {
    const sessionId = await createChatSessionForE2e()
    expect(sessionId).toBeTruthy()

    await browser.waitUntil(
      async () => (await (await browser.$$('[data-testid="session-tab"]')).length) >= 1,
      { timeout: 20000, interval: 300 },
    )
    // Brief settle so sidecar session:create / session:loaded does not race inject.
    await browser.pause(300)

    const msgId = `e2e-mem-cite-${Date.now()}`
    const body = 'We should use yarn for installs.'
    await injectServerMessage({
      type: 'message:complete',
      sessionId,
      message: {
        id: msgId,
        role: 'assistant',
        content: body,
        agentId: 'supervisor',
        timestamp: Date.now(),
        memoryCitations: [
          { memoryId: 'mem-e2e-1', title: 'Yarn preference' },
        ],
      },
    })

    const bubble = await browser.$(`//*[@data-message-id="${msgId}"]`)
    await bubble.waitForExist({ timeout: 15000 })
    await browser.waitUntil(async () => (await bubble.getText()).includes('yarn'), {
      timeout: 10000,
      interval: 300,
    })

    // Chip can exist but fail isDisplayed under WebKit overflow; use exist + scroll.
    await browser.waitUntil(
      async () => (await browser.$$('[data-testid="memory-citations-chip"]')).length >= 1,
      { timeout: 15000, interval: 300, timeoutMsg: 'memory-citations-chip not in DOM' },
    )
    const chip = await browser.$('[data-testid="memory-citations-chip"]')
    await browser.execute((el: HTMLElement) => {
      el.scrollIntoView({ block: 'center' })
    }, chip)
    await browser.execute((el: HTMLElement) => el.click(), chip)
    const list = await browser.$('[data-testid="memory-citations-list"]')
    await list.waitForExist({ timeout: 10000 })
    const text = await list.getText()
    expect(text.toLowerCase()).toMatch(/yarn|mem-e2e|preference/i)
  })
})
