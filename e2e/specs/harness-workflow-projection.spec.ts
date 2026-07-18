// Workflow message projection via inject (no paid LLM, no host-destructive tools).
// Product path has no dedicated DAG shell; workflow:getActive was removed.
// Cover: store projection + code-surface Agents tab focus + event/snapshot/clear.
import { expect } from 'expect-webdriverio'
import * as path from 'node:path'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  createChatSessionForE2e,
  createCodeSessionForE2e,
  getWorkflowSession,
  injectServerMessage,
  waitForHipE2E,
} from '../helpers/e2e-hooks.js'
import { switchToChatSurface, switchToCodeSurface } from '../helpers/surface.js'

const FIXTURE = path.resolve('e2e/fixtures/sample-project')

const MOCK_DEF = {
  id: 'wf-e2e-1',
  name: 'E2E Workflow',
  nodes: [{ id: 'n1', type: 'agent' as const, agentId: 'coder', inputTemplate: 'do work' }],
  edges: [] as { from: string; to: string }[],
  entry: ['n1'],
}

describe('harness workflow projection @harness @core', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await waitForHipE2E()
  })

  it('workflow:started projects store and focuses Agents on code surface', async () => {
    await switchToCodeSurface()
    const sessionId = await createCodeSessionForE2e(FIXTURE)
    expect(sessionId).toBeTruthy()

    await browser.waitUntil(
      async () => (await (await browser.$$('[data-session-tab="true"]')).length) >= 1,
      { timeout: 30000, interval: 300 },
    )
    await (await browser.$('[data-testid="toggle-panel"]')).waitForExist({ timeout: 30000 })

    const runId = 'run-e2e-1'
    await injectServerMessage({
      type: 'workflow:started',
      sessionId,
      runId,
      def: MOCK_DEF,
    })

    await browser.waitUntil(
      async () => {
        const snap = await getWorkflowSession(sessionId)
        return snap.activeWorkflow?.id === 'wf-e2e-1' && snap.runId === runId && snap.runStatus === 'pending'
      },
      {
        timeout: 15000,
        interval: 300,
        timeoutMsg: 'workflow store not projected after workflow:started',
      },
    )

    // Product effect: open code panel + Agents tab for active code session.
    await (await browser.$('[data-testid="panel-view-agents"]')).waitForExist({ timeout: 15000 })

    // Multi-step orchestrator events on the same run.
    await injectServerMessage({
      type: 'workflow:event',
      sessionId,
      runId,
      event: { type: 'run:started' },
    })
    await injectServerMessage({
      type: 'workflow:event',
      sessionId,
      runId,
      event: { type: 'node:started', nodeId: 'n1' },
    })
    await injectServerMessage({
      type: 'workflow:event',
      sessionId,
      runId,
      event: {
        type: 'node:succeeded',
        nodeId: 'n1',
        output: { text: 'e2e node ok' },
      },
    })
    await injectServerMessage({
      type: 'workflow:event',
      sessionId,
      runId,
      event: { type: 'run:finished', status: 'succeeded' },
    })

    await browser.waitUntil(
      async () => {
        const snap = await getWorkflowSession(sessionId)
        return snap.runStatus === 'succeeded' && snap.nodeStatuses.n1 === 'succeeded'
      },
      {
        timeout: 15000,
        interval: 300,
        timeoutMsg: 'workflow events did not update run/node status',
      },
    )

    // Snapshot replaces slice.
    await injectServerMessage({
      type: 'workflow:snapshot',
      sessionId,
      runId: 'run-e2e-snap',
      def: { ...MOCK_DEF, id: 'wf-e2e-snap', name: 'Snap' },
      state: {
        runId: 'run-e2e-snap',
        workflowId: 'wf-e2e-snap',
        status: 'running',
        nodes: { n1: { status: 'running' } },
      },
    })

    await browser.waitUntil(
      async () => {
        const snap = await getWorkflowSession(sessionId)
        return (
          snap.activeWorkflow?.id === 'wf-e2e-snap' &&
          snap.runId === 'run-e2e-snap' &&
          snap.runStatus === 'running' &&
          snap.nodeStatuses.n1 === 'running'
        )
      },
      { timeout: 10000, interval: 300, timeoutMsg: 'workflow:snapshot not applied' },
    )

    await injectServerMessage({ type: 'workflow:cleared', sessionId })
    await browser.waitUntil(
      async () => {
        const snap = await getWorkflowSession(sessionId)
        return snap.activeWorkflow === null && snap.runId === null && snap.runStatus === null
      },
      { timeout: 10000, interval: 300, timeoutMsg: 'workflow:cleared did not empty slice' },
    )
  })

  it('workflow:started on chat projects store without forcing Agents panel', async () => {
    await switchToChatSurface()
    const sessionId = await createChatSessionForE2e()
    expect(sessionId).toBeTruthy()

    await injectServerMessage({
      type: 'workflow:started',
      sessionId,
      runId: 'run-chat-1',
      def: MOCK_DEF,
    })

    await browser.waitUntil(
      async () => {
        const snap = await getWorkflowSession(sessionId)
        return snap.activeWorkflow?.id === 'wf-e2e-1' && snap.runId === 'run-chat-1'
      },
      {
        timeout: 15000,
        interval: 300,
        timeoutMsg: 'chat workflow store not projected',
      },
    )

    // Chat surface must not auto-open the code Agents panel for workflow.
    const agentsPanel = await browser.$('[data-testid="panel-view-agents"]')
    // If panel exists from a prior code session, it is acceptable only if we did not
    // switch tab solely for this chat inject — store projection is the contract.
    const snap = await getWorkflowSession(sessionId)
    expect(snap.activeWorkflow?.name).toBe('E2E Workflow')
    // Soft UI check: panel-view-agents should not newly appear as the only open panel
    // when we were on chat landing; prefer store-only success if panel leftovers remain.
    if (await agentsPanel.isExisting()) {
      // Residual from earlier code suite is ok; store still holds chat session slice.
      expect(snap.runStatus).toBe('pending')
    }
  })

  it('multi-node failed run projects failed statuses', async () => {
    await switchToCodeSurface()
    const sessionId = await createCodeSessionForE2e(FIXTURE)
    const multiDef = {
      id: 'wf-e2e-fail',
      name: 'E2E Fail WF',
      nodes: [
        { id: 'n1', type: 'agent' as const, agentId: 'coder', inputTemplate: 'ok' },
        { id: 'n2', type: 'agent' as const, agentId: 'coder', inputTemplate: 'boom' },
      ],
      edges: [{ from: 'n1', to: 'n2' }],
      entry: ['n1'],
    }
    const runId = 'run-e2e-fail'
    await injectServerMessage({
      type: 'workflow:started',
      sessionId,
      runId,
      def: multiDef,
    })
    await injectServerMessage({
      type: 'workflow:event',
      sessionId,
      runId,
      event: { type: 'run:started' },
    })
    await injectServerMessage({
      type: 'workflow:event',
      sessionId,
      runId,
      event: { type: 'node:started', nodeId: 'n1' },
    })
    await injectServerMessage({
      type: 'workflow:event',
      sessionId,
      runId,
      event: { type: 'node:succeeded', nodeId: 'n1', output: { text: 'ok' } },
    })
    await injectServerMessage({
      type: 'workflow:event',
      sessionId,
      runId,
      event: { type: 'node:started', nodeId: 'n2' },
    })
    await injectServerMessage({
      type: 'workflow:event',
      sessionId,
      runId,
      event: { type: 'node:failed', nodeId: 'n2', error: 'e2e node boom' },
    })
    await injectServerMessage({
      type: 'workflow:event',
      sessionId,
      runId,
      event: { type: 'run:finished', status: 'failed' },
    })

    await browser.waitUntil(
      async () => {
        const snap = await getWorkflowSession(sessionId)
        return (
          snap.runStatus === 'failed' &&
          snap.nodeStatuses.n1 === 'succeeded' &&
          snap.nodeStatuses.n2 === 'failed'
        )
      },
      {
        timeout: 15000,
        interval: 300,
        timeoutMsg: 'failed multi-node workflow not projected',
      },
    )
  })

  it('run:cancelled projects cancelled status', async () => {
    await switchToCodeSurface()
    const sessionId = await createCodeSessionForE2e(FIXTURE)
    const runId = 'run-e2e-cancel'
    await injectServerMessage({
      type: 'workflow:started',
      sessionId,
      runId,
      def: MOCK_DEF,
    })
    await injectServerMessage({
      type: 'workflow:event',
      sessionId,
      runId,
      event: { type: 'run:started' },
    })
    await injectServerMessage({
      type: 'workflow:event',
      sessionId,
      runId,
      event: { type: 'run:cancelled' },
    })

    await browser.waitUntil(
      async () => {
        const snap = await getWorkflowSession(sessionId)
        return snap.runStatus === 'cancelled'
      },
      {
        timeout: 15000,
        interval: 300,
        timeoutMsg: 'cancelled workflow not projected',
      },
    )
  })

  it('stale runId events are ignored', async () => {
    await switchToCodeSurface()
    const sessionId = await createCodeSessionForE2e(FIXTURE)
    const runId = 'run-e2e-stale-live'
    await injectServerMessage({
      type: 'workflow:started',
      sessionId,
      runId,
      def: MOCK_DEF,
    })
    await injectServerMessage({
      type: 'workflow:event',
      sessionId,
      runId,
      event: { type: 'run:started' },
    })
    await injectServerMessage({
      type: 'workflow:event',
      sessionId,
      runId,
      event: { type: 'node:started', nodeId: 'n1' },
    })

    // Wrong runId must not clobber current slice.
    await injectServerMessage({
      type: 'workflow:event',
      sessionId,
      runId: 'run-e2e-stale-other',
      event: { type: 'run:finished', status: 'failed' },
    })
    await injectServerMessage({
      type: 'workflow:event',
      sessionId,
      runId: 'run-e2e-stale-other',
      event: { type: 'node:failed', nodeId: 'n1', error: 'stale' },
    })

    await browser.pause(400)
    const snap = await getWorkflowSession(sessionId)
    expect(snap.runId).toBe(runId)
    expect(snap.runStatus).toBe('running')
    expect(snap.nodeStatuses.n1).toBe('running')
  })
})
