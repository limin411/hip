// Multi-track B: subagent pause marker projection (no paid LLM).
// Contract: first-line [hip:subagent_paused]; never "Error: sub-agent paused".
// Note: parent `task` tool rows are intentionally suppressed in TurnTimeline
// (see timelineFilter.isSuppressedToolStep); UI surfaces marker via assistant
// text + delegation / agent cards.
import { expect } from 'expect-webdriverio'
import * as path from 'node:path'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  createCodeSessionForE2e,
  getLastAssistantText,
  seedSubagentPause,
  waitForHipE2E,
} from '../helpers/e2e-hooks.js'
import { selectPanelTab } from '../helpers/panel.js'
import { switchToCodeSurface } from '../helpers/surface.js'

const FIXTURE = path.resolve('e2e/fixtures/sample-project')
const PAUSE_MARKER = '[hip:subagent_paused]'
const FORBIDDEN_PREFIX = 'Error: sub-agent paused'

describe('harness subagent pause @harness @core', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await waitForHipE2E()
    await switchToCodeSurface()
  })

  it('shows pause marker and delegation without Error: prefix', async () => {
    const sessionId = await createCodeSessionForE2e(FIXTURE)
    expect(sessionId).toBeTruthy()

    await browser.waitUntil(
      async () => (await (await browser.$$('[data-testid="session-tab"]')).length) >= 1,
      { timeout: 30000, interval: 300 },
    )
    await (await browser.$('[data-testid="toggle-panel"]')).waitForExist({ timeout: 30000 })

    const { turnId, marker } = await seedSubagentPause(sessionId)
    expect(turnId).toMatch(/^e2e-turn-/)
    expect(marker).toBe(PAUSE_MARKER)

    // Store + DOM: marker visible in assistant projection (not Error: prefix).
    await browser.waitUntil(
      async () => {
        const text = await getLastAssistantText(sessionId)
        return !!text && text.includes(PAUSE_MARKER)
      },
      {
        timeout: 15000,
        interval: 300,
        timeoutMsg: 'assistant text missing pause marker',
      },
    )
    const assistantText = (await getLastAssistantText(sessionId)) ?? ''
    expect(assistantText).toContain(PAUSE_MARKER)
    expect(assistantText.toLowerCase()).not.toContain(FORBIDDEN_PREFIX.toLowerCase())

    const answer = await browser.$(`[data-message-id="${turnId}"] [data-testid="message-answer"]`)
    await answer.waitForExist({ timeout: 15000 })
    await browser.waitUntil(
      async () => (await answer.getText()).includes(PAUSE_MARKER),
      {
        timeout: 10000,
        interval: 300,
        timeoutMsg: 'message-answer missing pause marker',
      },
    )
    const answerText = await answer.getText()
    expect(answerText).toContain(PAUSE_MARKER)
    expect(answerText.toLowerCase()).not.toContain(FORBIDDEN_PREFIX.toLowerCase())

    // ActivityBar expand → delegation-row (task tool row is suppressed by design).
    const activityBar = await browser.$('[data-testid="activity-bar"]')
    await activityBar.waitForExist({ timeout: 15000 })
    const expandBtn = await activityBar.$('button')
    await expandBtn.waitForExist({ timeout: 5000 })
    await browser.execute((el: HTMLElement) => el.click(), expandBtn)

    const delegation = await browser.$('[data-testid="delegation-row"]')
    await delegation.waitForExist({ timeout: 10000 })
    expect((await delegation.getText()).toLowerCase()).toContain('e2e implement feature')

    // Agents panel: supervisor + coder cards.
    await selectPanelTab('agents')
    await (await browser.$('[data-testid="panel-view-agents"]')).waitForExist({ timeout: 15000 })
    await browser.waitUntil(
      async () => (await (await browser.$$('[data-testid="agent-card"]')).length) >= 2,
      {
        timeout: 15000,
        interval: 300,
        timeoutMsg: 'expected supervisor + coder agent cards',
      },
    )
  })
})
