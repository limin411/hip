// Phase 3 H7: delegation-row in chat (no LLM).
import { expect } from 'expect-webdriverio'
import * as path from 'node:path'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  createCodeSessionForE2e,
  seedAgentCollaboration,
  waitForHipE2E,
} from '../helpers/e2e-hooks.js'
import { switchToCodeSurface } from '../helpers/surface.js'

const FIXTURE = path.resolve('e2e/fixtures/sample-project')

describe('harness delegation @harness @core', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await waitForHipE2E()
    await switchToCodeSurface()
  })

  it('shows delegation-row in the chat activity trail', async () => {
    const sessionId = await createCodeSessionForE2e(FIXTURE)
    expect(sessionId).toBeTruthy()

    await browser.waitUntil(
      async () => (await (await browser.$$('[data-session-tab="true"]')).length) >= 1,
      { timeout: 30000, interval: 300 },
    )
    await (await browser.$('[data-testid="toggle-panel"]')).waitForExist({ timeout: 30000 })

    const { turnId } = await seedAgentCollaboration(sessionId)
    expect(turnId).toMatch(/^e2e-turn-/)

    // Inline activity: expand ActivityBar → TurnTimeline delegation-row.
    const activityBar = await browser.$('[data-testid="activity-bar"]')
    await activityBar.waitForExist({ timeout: 15000 })
    const expandBtn = await activityBar.$('button')
    await expandBtn.waitForExist({ timeout: 5000 })
    // U2: may already be expanded while streaming — only click when collapsed.
    const expanded = await expandBtn.getAttribute('aria-expanded')
    if (expanded !== 'true') {
      await browser.execute((el: HTMLElement) => el.click(), expandBtn)
    }

    const delegation = await browser.$('[data-testid="delegation-row"]')
    await delegation.waitForExist({ timeout: 10000 })
    expect(await delegation.isExisting()).toBe(true)
    const delText = await delegation.getText()
    expect(delText.toLowerCase()).toContain('e2e implement feature')
  })
})
