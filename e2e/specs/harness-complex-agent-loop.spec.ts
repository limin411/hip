// Complex multi-step agent-loop projection via safe DEV inject (no paid LLM, no host-destructive tools).
// Chains: turn+tool → multi-agent collab → permission HITL → cancel keeps partial.
import { expect } from 'expect-webdriverio'
import * as path from 'node:path'
import { leaveSpecialViewsIfOpen, waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  createCodeSessionForE2e,
  injectServerMessage,
  seedAgentCollaboration,
  simulatePermissionRequest,
  simulateTurnCancelled,
  simulateTurnRunning,
  waitForHipE2E,
} from '../helpers/e2e-hooks.js'
import { selectPanelTab } from '../helpers/panel.js'
import { switchToCodeSurface } from '../helpers/surface.js'
import { ChatPage } from '../page-objects/ChatPage.js'

const FIXTURE = path.resolve('e2e/fixtures/sample-project')
const chat = new ChatPage()

describe('harness complex agent loop @harness @core', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
    await waitForHipE2E()
    await switchToCodeSurface()
  })

  it('projects multi-step tool, multi-agent, permission, then cancel on one session', async () => {
    const sessionId = await createCodeSessionForE2e(FIXTURE)
    expect(sessionId).toBeTruthy()

    await browser.waitUntil(
      async () => (await (await browser.$$('[data-testid="session-tab"]')).length) >= 1,
      { timeout: 30000, interval: 300 },
    )
    await (await browser.$('[data-testid="toggle-panel"]')).waitForExist({ timeout: 30000 })

    // ── Step 1: running turn with partial stream + in-flight tool ──
    const { turnId, callId } = await simulateTurnRunning(sessionId)
    expect(turnId).toMatch(/^e2e-turn-/)
    expect(callId).toMatch(/^e2e-call-/)

    const stop = await chat.composerStop
    await stop.waitForExist({ timeout: 15000 })

    const partialBubble = await browser.$(`//*[@data-message-id="${turnId}"]`)
    await partialBubble.waitForExist({ timeout: 15000 })
    await browser.waitUntil(async () => (await partialBubble.getText()).includes('partial e2e reply'), {
      timeout: 10000,
      interval: 300,
    })

    // Finish the first tool via the same inject pipeline as the sidecar.
    await injectServerMessage({
      type: 'tool:finished',
      sessionId,
      turnId,
      agentId: 'supervisor',
      callId,
      status: 'finished',
      output: 'e2e tool ok',
    })

    // ToolCallRow mounts inside expanded ActivityBar (collapsed by default).
    const activityBarStep1 = await browser.$('[data-testid="activity-bar"]')
    await activityBarStep1.waitForExist({ timeout: 15000 })
    const expandStep1 = await activityBarStep1.$('button')
    await expandStep1.waitForExist({ timeout: 5000 })
    await browser.execute((el: HTMLElement) => el.click(), expandStep1)

    await browser.waitUntil(
      async () => (await (await browser.$$('[data-testid="tool-row"]')).length) >= 1,
      {
        timeout: 15000,
        interval: 300,
        timeoutMsg: 'expected tool-row after tool:finished + activity-bar expand',
      },
    )

    // ── Step 2: multi-agent collaboration on a second turn ──
    const collab = await seedAgentCollaboration(sessionId)
    expect(collab.turnId).toMatch(/^e2e-turn-/)

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

    // Delegation row lives under expanded ActivityBar for the collab turn (optional soft check).
    // Agents panel cards above are the hard multi-agent assertion.
    const activityBars = await browser.$$('[data-testid="activity-bar"]')
    if (activityBars.length > 0) {
      const lastBar = activityBars[activityBars.length - 1]
      const expandBtn = await lastBar.$('button')
      if (await expandBtn.isExisting()) {
        await browser.execute((el: HTMLElement) => el.click(), expandBtn)
      }
      const delegation = await browser.$('[data-testid="delegation-row"]')
      if (await delegation.isExisting()) {
        expect((await delegation.getText()).toLowerCase()).toContain('e2e implement feature')
      }
    }

    // ── Step 3: permission HITL mid-loop ──
    const { requestId } = await simulatePermissionRequest(sessionId)
    expect(requestId).toMatch(/^e2e-perm-/)

    const modal = await chat.permissionModal
    await modal.waitForExist({ timeout: 15000 })
    expect(await modal.getText()).toContain('e2e-run-script')

    const allow = await chat.permissionOption('allow_once')
    await allow.waitForExist({ timeout: 5000 })
    await browser.execute((el: HTMLElement) => el.click(), allow)
    await browser.waitUntil(async () => !(await (await chat.permissionModal).isExisting()), {
      timeout: 10000,
      interval: 200,
      timeoutMsg: 'permission-modal still open after allow',
    })

    // ── Step 4: cancel keeps partial assistant; Stop leaves ──
    // Re-enter running so cancel has something to finalize (permission path may idle the session).
    const runningAgain = await simulateTurnRunning(sessionId)
    await (await chat.composerStop).waitForExist({ timeout: 15000 })
    await simulateTurnCancelled(sessionId)

    await browser.waitUntil(async () => !(await (await chat.composerStop).isExisting()), {
      timeout: 15000,
      interval: 300,
      timeoutMsg: 'composer-stop still present after cancel',
    })

    const cancelledBubble = await browser.$(`//*[@data-message-id="${runningAgain.turnId}"]`)
    await cancelledBubble.waitForExist({ timeout: 15000 })
    await browser.waitUntil(
      async () => (await cancelledBubble.getText()).includes('partial e2e reply'),
      { timeout: 10000, interval: 300 },
    )
    expect(await cancelledBubble.getText()).toContain('partial e2e reply')
  })
})
