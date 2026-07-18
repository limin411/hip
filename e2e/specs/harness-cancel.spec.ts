// e2e/specs/harness-cancel.spec.ts
// Phase 1 H2: cancel / partial assistant without paid LLM.
import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  createChatSessionForE2e,
  simulateTurnCancelled,
  simulateTurnRunning,
  waitForHipE2E,
} from '../helpers/e2e-hooks.js'
import { switchToChatSurface } from '../helpers/surface.js'
import { ChatPage } from '../page-objects/ChatPage.js'

const chat = new ChatPage()

describe('harness cancel projection @harness @smoke', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await waitForHipE2E()
    await switchToChatSurface()
  })

  it('shows Stop while running and keeps partial assistant after cancel', async () => {
    const sessionId = await createChatSessionForE2e()
    expect(sessionId).toBeTruthy()

    await browser.waitUntil(
      async () => (await (await browser.$$('[data-session-tab="true"]')).length) >= 1,
      { timeout: 30000, interval: 300 },
    )

    const { turnId } = await simulateTurnRunning(sessionId)
    expect(turnId).toMatch(/^e2e-turn-/)

    const stop = await chat.composerStop
    await stop.waitForExist({ timeout: 15000 })
    // Click Stop to exercise UI wiring (sidecar may no-op without a real turn).
    await browser.execute((el: HTMLElement) => el.click(), stop)

    await simulateTurnCancelled(sessionId)

    // Stop control should leave after status returns to idle.
    await browser.waitUntil(async () => !(await (await chat.composerStop).isExisting()), {
      timeout: 15000,
      interval: 300,
      timeoutMsg: 'composer-stop still present after cancel projection',
    })

    const bubble = await browser.$(`//*[@data-message-id="${turnId}"]`)
    await bubble.waitForExist({ timeout: 15000 })
    await browser.waitUntil(async () => (await bubble.getText()).includes('partial e2e reply'), {
      timeout: 10000,
      interval: 300,
    })
    expect(await bubble.getText()).toContain('partial e2e reply')
  })
})
