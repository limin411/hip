// e2e/specs/roundtable-council.spec.ts
// Council multi-agent: roster + edges on Agents panel (seeded, no live LLM).
import { expect } from 'expect-webdriverio'
import { leaveSpecialViewsIfOpen, waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  createChatSessionForE2e,
  seedRoundtableCouncil,
  waitForHipE2E,
} from '../helpers/e2e-hooks.js'
import { selectPanelTab } from '../helpers/panel.js'
import { switchToChatSurface } from '../helpers/surface.js'

describe('roundtable council panel @harness @panel @roundtable', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
    await waitForHipE2E()
  })

  it('shows council roster seats and discussion edges after seed', async () => {
    await switchToChatSurface()
    const sessionId = await createChatSessionForE2e()
    expect(sessionId).toBeTruthy()

    await seedRoundtableCouncil(sessionId)

    await selectPanelTab('agents')
    const view = await browser.$('[data-testid="panel-view-agents"]')
    await view.waitForExist({ timeout: 15000 })

    const roster = await browser.$('[data-testid="council-roster"]')
    await roster.waitForExist({ timeout: 15000 })
    expect(await roster.isExisting()).toBe(true)

    for (const persona of ['strategist', 'skeptic', 'creative', 'operator', 'audience']) {
      const seat = await browser.$(`[data-testid="council-seat-${persona}"]`)
      await seat.waitForExist({ timeout: 10000 })
      expect(await seat.isExisting()).toBe(true)
    }

    const edges = await browser.$('[data-testid="council-edges"]')
    await edges.waitForExist({ timeout: 10000 })
    expect(await edges.isExisting()).toBe(true)
    const edgeRows = await browser.$$('[data-testid="council-edge-row"]')
    expect(edgeRows.length).toBeGreaterThanOrEqual(1)

    // Main transcript still shows decision
    const answer = await browser.$('[data-testid="message-answer"]')
    await answer.waitForExist({ timeout: 10000 })
    const text = await answer.getText()
    expect(text.toLowerCase()).toMatch(/decision|phased|meeting plan/i)
  })
})
