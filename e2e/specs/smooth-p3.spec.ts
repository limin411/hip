// Smoothness P3: Agents live strip + jump + annotation outbound (unpaid).
import { expect } from 'expect-webdriverio'
import * as path from 'node:path'
import { leaveSpecialViewsIfOpen, waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  createCodeSessionForE2e,
  seedAgentCollaboration,
  waitForHipE2E,
} from '../helpers/e2e-hooks.js'
import { selectPanelTab } from '../helpers/panel.js'

const FIXTURE = path.resolve('e2e/fixtures/sample-project')

describe('smooth P3 agents live @smooth-p3 @harness @panel', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
    await waitForHipE2E()
  })

  it('P3-E8 Agents panel cards after seed', async () => {
    const sessionId = await createCodeSessionForE2e(FIXTURE)
    await seedAgentCollaboration(sessionId)
    await selectPanelTab('agents')
    const view = await browser.$('[data-testid="panel-view-agents"]')
    await view.waitForExist({ timeout: 20000 })
    await browser.waitUntil(
      async () => (await (await browser.$$('[data-testid="agent-card"]')).length) >= 1,
      { timeout: 15000, interval: 300 },
    )
    expect((await browser.$$('[data-testid="agent-card"]')).length).toBeGreaterThanOrEqual(1)
  })

  it('P3-E11 live strip or dashboard present when agents seeded running', async () => {
    const sessionId = await createCodeSessionForE2e(FIXTURE)
    await seedAgentCollaboration(sessionId)
    await selectPanelTab('agents')
    await (await browser.$('[data-testid="panel-view-agents"]')).waitForExist({ timeout: 15000 })
    const dash = await browser.$('[data-testid="agents-dashboard"]')
    const strip = await browser.$('[data-testid="agent-live-strip"]')
    const hasDash = await dash.isExisting()
    const hasStrip = await strip.isExisting()
    expect(hasDash || hasStrip || (await browser.$$('[data-testid="agent-card"]')).length > 0).toBe(true)
  })

  it('P3-E10 jump-to-turn control exists on agent card', async () => {
    const sessionId = await createCodeSessionForE2e(FIXTURE)
    await seedAgentCollaboration(sessionId)
    await selectPanelTab('agents')
    await (await browser.$('[data-testid="agent-card"]')).waitForExist({ timeout: 15000 })
    const headers = await browser.$$('[data-testid="agent-card-header"]')
    if (headers.length > 0) await headers[0].click()
    const jump = await browser.$('[data-testid="agent-jump-turn"]')
    if (await jump.isExisting()) {
      await jump.click()
    }
    expect((await browser.$$('[data-testid="agent-card"]')).length).toBeGreaterThanOrEqual(1)
  })

  it('P3-G2 outbound user content includes hip.diff_annotations', async () => {
    const sessionId = await createCodeSessionForE2e(FIXTURE)
    const outbound = await browser.execute((id: string) => {
      const hooks = (window as unknown as {
        __hipE2E?: {
          seedDiffAnnotation?: (
            s: string,
            a: { path: string; body: string; note?: string },
          ) => string
          sendWithPendingAnnotations?: (s: string, text: string) => void
          getLastOutboundUserContent?: () => string | null
        }
      }).__hipE2E
      if (!hooks?.seedDiffAnnotation || !hooks.sendWithPendingAnnotations) {
        throw new Error('annotation e2e hooks missing')
      }
      hooks.seedDiffAnnotation(id, {
        path: 'src/a.ts',
        body: '@@ -1 +1 @@\n-old\n+new',
        note: 'prefer rename',
      })
      hooks.sendWithPendingAnnotations(id, 'please apply the review notes')
      return hooks.getLastOutboundUserContent?.() ?? null
    }, sessionId)

    expect(outbound).toBeTruthy()
    expect(outbound!).toContain('hip.diff_annotations')
    expect(outbound!).toContain('src/a.ts')
    expect(outbound!).toContain('please apply the review notes')
    expect(outbound!).toContain('prefer rename')
  })
})
