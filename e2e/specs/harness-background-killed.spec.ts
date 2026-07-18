// Multi-track B: background task killed notification projection (no paid LLM).
import { expect } from 'expect-webdriverio'
import * as path from 'node:path'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  createCodeSessionForE2e,
  getLastAssistantText,
  seedBackgroundTaskKilled,
  waitForHipE2E,
} from '../helpers/e2e-hooks.js'
import { switchToCodeSurface } from '../helpers/surface.js'

const FIXTURE = path.resolve('e2e/fixtures/sample-project')

describe('harness background killed @harness @panel', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await waitForHipE2E()
    await switchToCodeSurface()
  })

  it('projects killed background notification in chat transcript', async () => {
    const sessionId = await createCodeSessionForE2e(FIXTURE)
    expect(sessionId).toBeTruthy()

    await browser.waitUntil(
      async () => (await (await browser.$$('[data-session-tab="true"]')).length) >= 1,
      { timeout: 30000, interval: 300 },
    )

    const { turnId, taskId } = await seedBackgroundTaskKilled(sessionId)
    expect(taskId).toMatch(/^e2e-bg-/)
    expect(turnId).toBe(`notif-${taskId}`)

    await browser.waitUntil(
      async () => {
        const text = await getLastAssistantText(sessionId)
        return !!text && text.toLowerCase().includes('killed')
      },
      {
        timeout: 15000,
        interval: 300,
        timeoutMsg: 'killed notification not in store',
      },
    )
    const storeText = (await getLastAssistantText(sessionId)) ?? ''
    expect(storeText).toContain('e2e background job')
    expect(storeText.toLowerCase()).toContain('killed')

    const bubble = await browser.$(`[data-message-id="${turnId}"]`)
    await bubble.waitForExist({ timeout: 15000 })
    const uiText = await bubble.getText()
    expect(uiText.toLowerCase()).toContain('killed')
    expect(uiText).toContain('e2e background job')
  })
})
