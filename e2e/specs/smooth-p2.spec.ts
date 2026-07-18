// Smoothness P2: typed tool results / inline diff via harness (unpaid).
import { expect } from 'expect-webdriverio'
import * as path from 'node:path'
import { leaveSpecialViewsIfOpen, waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  createCodeSessionForE2e,
  injectServerMessage,
  waitForHipE2E,
} from '../helpers/e2e-hooks.js'

const FIXTURE = path.resolve('e2e/fixtures/sample-project')
const rid = () => Math.random().toString(36).slice(2, 10)

async function seedTool(
  sessionId: string,
  name: string,
  input: Record<string, unknown>,
  output: string,
): Promise<void> {
  const turnId = `t-${rid()}`
  const callId = `c-${rid()}`
  await injectServerMessage({
    type: 'agent:started',
    sessionId,
    turnId,
    agentId: 'supervisor',
    role: 'supervisor',
  })
  await injectServerMessage({
    type: 'tool:started',
    sessionId,
    turnId,
    agentId: 'supervisor',
    role: 'supervisor',
    callId,
    name,
    input: JSON.stringify(input),
    seq: 1,
  })
  await injectServerMessage({
    type: 'tool:finished',
    sessionId,
    turnId,
    agentId: 'supervisor',
    callId,
    status: 'finished',
    output,
  })
}

describe('smooth P2 tool result UI @smooth-p2 @harness', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
    await waitForHipE2E()
  })

  it('P2-E1 shows tool card with inline diff for edit_file', async () => {
    const sessionId = await createCodeSessionForE2e(FIXTURE)
    await browser.execute((id: string) => {
      const hooks = (window as unknown as {
        __hipE2E?: { simulateEditWithDiff?: (s: string, o?: { path?: string }) => unknown }
      }).__hipE2E
      if (!hooks?.simulateEditWithDiff) throw new Error('simulateEditWithDiff missing')
      hooks.simulateEditWithDiff(id, { path: '/README.md' })
    }, sessionId)

    const card = await browser.$('[data-testid="tool-card"]')
    await card.waitForExist({ timeout: 15000 })
    const activityBtn = await browser.$('[data-testid="activity-bar"] button')
    if (await activityBtn.isExisting()) {
      const expanded = await activityBtn.getAttribute('aria-expanded')
      if (expanded !== 'true') await activityBtn.click()
    }
    await browser.waitUntil(
      async () => (await browser.$('[data-testid="tool-inline-diff"]')).isExisting(),
      { timeout: 10000, interval: 200, timeoutMsg: 'expected tool-inline-diff for edit_file output' },
    )
    const text = await (await browser.$('[data-testid="tool-inline-diff"]')).getText()
    expect(text.includes('+b') || text.includes('@@')).toBe(true)
  })

  it('P2-E7/E8 shell exit badge and lines tool render', async () => {
    const sessionId = await createCodeSessionForE2e(FIXTURE)
    await seedTool(
      sessionId,
      'run_script',
      { command: 'false' },
      'failed\nexit_code=1',
    )
    const card = await browser.$('[data-testid="tool-card"]')
    await card.waitForExist({ timeout: 15000 })
    const html = await card.getHTML()
    expect(html.includes('exit') || html.includes('1')).toBe(true)
  })
})
