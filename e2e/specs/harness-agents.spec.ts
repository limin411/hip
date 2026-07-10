// e2e/specs/harness-agents.spec.ts
// Phase 1 H6: Agents panel structure + cards via inject (no LLM).
import { expect } from 'expect-webdriverio'
import * as path from 'node:path'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  createCodeSessionForE2e,
  seedAgentCollaboration,
  waitForHipE2E,
} from '../helpers/e2e-hooks.js'
import { selectPanelTab } from '../helpers/panel.js'
import { switchToCodeSurface } from '../helpers/surface.js'

const FIXTURE = path.resolve('e2e/fixtures/sample-project')

describe('harness agents panel @harness @panel', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await waitForHipE2E()
    await switchToCodeSurface()
  })

  it('shows collaboration structure and agent cards after seed', async () => {
    const sessionId = await createCodeSessionForE2e(FIXTURE)
    expect(sessionId).toBeTruthy()

    await browser.waitUntil(
      async () => (await (await browser.$$('[data-testid="session-tab"]')).length) >= 1,
      { timeout: 30000, interval: 300 },
    )
    await (await browser.$('[data-testid="toggle-panel"]')).waitForExist({ timeout: 30000 })

    await seedAgentCollaboration(sessionId)

    await selectPanelTab('agents')
    const view = await browser.$('[data-testid="panel-view-agents"]')
    await view.waitForExist({ timeout: 15000 })

    const structure = await browser.$('[data-testid="collaboration-structure"]')
    await structure.waitForExist({ timeout: 15000 })
    expect(await structure.isExisting()).toBe(true)

    await browser.waitUntil(
      async () => (await (await browser.$$('[data-testid="agent-card"]')).length) >= 2,
      {
        timeout: 15000,
        interval: 300,
        timeoutMsg: 'expected supervisor + coder agent cards',
      },
    )
    expect((await browser.$$('[data-testid="agent-card"]')).length).toBeGreaterThanOrEqual(2)
  })
})
