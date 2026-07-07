import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseSync } from '../persistence/sqlite.js'
import { SqliteWorkflowStore } from '../persistence/workflow-store.js'
import { WORKFLOW_DDL } from '../persistence/schema.js'
import { DurableExecutor } from './durable-executor.js'
import { FakeAgentRunner, CollectingEventSink } from './ports.js'
import type { WorkflowDef } from '@hip/protocol'

function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  for (const ddl of WORKFLOW_DDL) db.exec(ddl)
  return db
}

describe('Orchestrator E2E', () => {
  let db: DatabaseSync
  let store: SqliteWorkflowStore

  beforeEach(() => {
    db = createTestDb()
    store = new SqliteWorkflowStore(db)
  })

  afterEach(() => db.close())

  // ─── Scenario 1: Sequential pipeline (plan → code → review) ───

  it('sequential pipeline: plan → code → review', async () => {
    const def: WorkflowDef = {
      id: 'wf-pipeline',
      name: 'Plan-Code-Review',
      nodes: [
        { type: 'agent', id: 'planner', agentId: 'plan', inputTemplate: 'Plan: {{input}}' },
        { type: 'agent', id: 'coder', agentId: 'worker', inputTemplate: 'Code based on: {{planner}}' },
        { type: 'agent', id: 'reviewer', agentId: 'worker', inputTemplate: 'Review: {{coder}}' },
      ],
      edges: [
        { from: 'planner', to: 'coder' },
        { from: 'coder', to: 'reviewer' },
      ],
      entry: ['planner'],
    }

    const runner = new FakeAgentRunner({
      planner: { text: 'Plan: use React + Tailwind' },
      coder: { text: 'Code: implemented component' },
      reviewer: { text: 'Review: LGTM' },
    })
    const sink = new CollectingEventSink()
    const executor = new DurableExecutor(store)

    const ctrl = new AbortController()
    const state = await executor.runWorkflow(
      def,
      { agentRunner: runner, eventSink: sink },
      {
        runId: 'r-pipeline',
        runInputs: { text: 'Build a login form' },
        signal: ctrl.signal,
      },
    )

    // Final state assertions
    expect(state.status).toBe('succeeded')
    expect(state.nodes['planner'].status).toBe('succeeded')
    expect(state.nodes['coder'].status).toBe('succeeded')
    expect(state.nodes['reviewer'].status).toBe('succeeded')

    // Output flows through templates
    expect(state.nodes['planner'].output?.text).toContain('React + Tailwind')
    expect(state.nodes['coder'].output?.text).toContain('implemented component')
    expect(state.nodes['reviewer'].output?.text).toContain('LGTM')

    // Nodes execute in correct order via input template resolution
    const plannerCall = runner.calls.find((c) => c.nodeId === 'planner')!
    const coderCall = runner.calls.find((c) => c.nodeId === 'coder')!
    const reviewerCall = runner.calls.find((c) => c.nodeId === 'reviewer')!

    expect(plannerCall.input.text).toBe('Plan: Build a login form')
    expect(coderCall.input.text).toContain('React + Tailwind')
    expect(reviewerCall.input.text).toContain('implemented component')

    // Event stream contains exactly one of each expected type
    const startedEvents = sink.ofType('node:started')
    expect(startedEvents).toHaveLength(3)
    expect(startedEvents.map((e) => e.nodeId)).toEqual([
      'planner',
      'coder',
      'reviewer',
    ])

    const succeededEvents = sink.ofType('node:succeeded')
    expect(succeededEvents).toHaveLength(3)
    expect(succeededEvents.map((e) => e.nodeId)).toEqual([
      'planner',
      'coder',
      'reviewer',
    ])

    // Event ordering
    const eventTypes = sink.events.map((e) => e.type)
    expect(eventTypes).toEqual([
      'run:started',
      'node:started',
      'node:succeeded',
      'node:started',
      'node:succeeded',
      'node:started',
      'node:succeeded',
      'run:finished',
    ])

    const finished = sink.ofType('run:finished')
    expect(finished).toHaveLength(1)
    expect(finished[0].status).toBe('succeeded')
  })

  // ─── Scenario 2: Parallel fan-out ───

  it('parallel fan-out: research + implement in parallel', async () => {
    const def: WorkflowDef = {
      id: 'wf-fanout',
      name: 'Research and Implement',
      nodes: [
        { type: 'agent', id: 'researcher', agentId: 'explore', inputTemplate: 'Research: {{input}}' },
        { type: 'agent', id: 'implementer', agentId: 'worker', inputTemplate: 'Implement: {{input}}' },
      ],
      edges: [],
      entry: ['researcher', 'implementer'],
    }

    const runner = new FakeAgentRunner({
      researcher: { text: 'Research: found 3 approaches' },
      implementer: { text: 'Code: implemented best approach', delayMs: 50 },
    })
    const sink = new CollectingEventSink()
    const executor = new DurableExecutor(store)

    const ctrl = new AbortController()
    const state = await executor.runWorkflow(
      def,
      { agentRunner: runner, eventSink: sink },
      { runId: 'r-fanout', signal: ctrl.signal },
    )

    expect(state.status).toBe('succeeded')

    // Both entry nodes should succeed
    expect(state.nodes['researcher'].status).toBe('succeeded')
    expect(state.nodes['implementer'].status).toBe('succeeded')

    // Both nodes were called
    const called = runner.calls.map((c) => c.nodeId)
    expect(called).toContain('researcher')
    expect(called).toContain('implementer')

    // Both outputs are correct
    expect(state.nodes['researcher'].output?.text).toContain('found 3 approaches')
    expect(state.nodes['implementer'].output?.text).toContain('implemented best approach')

    // Event stream: run:started, then 2 node sequences (started/succeeded) in some order,
    // then run:finished
    const startedEvents = sink.ofType('node:started')
    expect(startedEvents).toHaveLength(2)
    expect(startedEvents.map((e) => e.nodeId).sort()).toEqual([
      'implementer',
      'researcher',
    ])

    const succeededEvents = sink.ofType('node:succeeded')
    expect(succeededEvents).toHaveLength(2)

    const finished = sink.ofType('run:finished')
    expect(finished).toHaveLength(1)
    expect(finished[0].status).toBe('succeeded')
  })

  // ─── Scenario 3: Crash recovery with resume ───

  it('resumes from checkpoint after simulated crash', async () => {
    const def: WorkflowDef = {
      id: 'wf-recovery',
      name: 'Recovery Test',
      nodes: [
        { type: 'agent', id: 'step1', agentId: 'worker', inputTemplate: 'step 1' },
        { type: 'agent', id: 'step2', agentId: 'worker', inputTemplate: 'step 2 after {{step1}}' },
        { type: 'agent', id: 'step3', agentId: 'worker', inputTemplate: 'step 3 after {{step2}}' },
      ],
      edges: [
        { from: 'step1', to: 'step2' },
        { from: 'step2', to: 'step3' },
      ],
      entry: ['step1'],
    }

    // ── Phase 1: Execute step1, abort mid-execution (simulating crash) ──

    const partialRunner = new FakeAgentRunner({
      step1: { text: 'done-1' },
      step2: { text: '', delayMs: 99999 }, // never finishes naturally
      step3: { text: '', delayMs: 99999 },
    })

    const executor1 = new DurableExecutor(store)
    const ctrl1 = new AbortController()

    const firstRunPromise = executor1.runWorkflow(
      def,
      { agentRunner: partialRunner },
      { runId: 'r-recover', signal: ctrl1.signal },
    )

    // Wait for step1 to complete (it has no delay, so 100ms is ample)
    await new Promise((r) => setTimeout(r, 100))
    ctrl1.abort()

    const partialState = await firstRunPromise

    // step1 completed before the abort
    expect(partialState.nodes['step1'].status).toBe('succeeded')
    expect(partialState.nodes['step1'].output?.text).toBe('done-1')
    // step2 and step3 were cancelled
    expect(partialState.nodes['step2'].status).toBe('cancelled')
    expect(partialState.nodes['step3'].status).toBe('cancelled')

    // ── Phase 2: Simulate crash recovery by restoring state to 'running' ──

    // Load the persisted state and reset it for resumption
    const persisted = await store.loadRun('r-recover')
    expect(persisted).not.toBeNull()
    expect(persisted!.status).toBe('cancelled')

    persisted!.status = 'running'
    persisted!.nodes['step2'] = { status: 'ready' }
    persisted!.nodes['step3'] = { status: 'pending' }
    await store.saveRun(persisted!)

    // Also reset the DB `status` column (saveRun already does this via upsert)

    // ── Phase 3: Resume with a fresh executor ──

    const freshRunner = new FakeAgentRunner({
      step2: { text: 'done-2' },
      step3: { text: 'done-3' },
    })
    const freshSink = new CollectingEventSink()
    const executor2 = new DurableExecutor(store)
    const ctrl2 = new AbortController()

    const finalState = await executor2.runWorkflow(
      def,
      { agentRunner: freshRunner, eventSink: freshSink },
      { runId: 'r-recover', signal: ctrl2.signal },
    )

    // step1 was NOT re-executed
    expect(freshRunner.calls.map((c) => c.nodeId)).not.toContain('step1')

    // step2 and step3 were executed during resume
    const resumeNodeIds = freshRunner.calls.map((c) => c.nodeId)
    expect(resumeNodeIds).toContain('step2')
    expect(resumeNodeIds).toContain('step3')

    // step2 received step1's output via template
    const step2Call = freshRunner.calls.find((c) => c.nodeId === 'step2')!
    expect(step2Call.input.text).toBe('step 2 after done-1')

    // step3 received step2's output via template
    const step3Call = freshRunner.calls.find((c) => c.nodeId === 'step3')!
    expect(step3Call.input.text).toBe('step 3 after done-2')

    // Final state is fully succeeded
    expect(finalState.status).toBe('succeeded')
    expect(finalState.nodes['step1'].status).toBe('succeeded')
    expect(finalState.nodes['step2'].status).toBe('succeeded')
    expect(finalState.nodes['step3'].status).toBe('succeeded')

    // step1 output is preserved from the first run
    expect(finalState.nodes['step1'].output?.text).toBe('done-1')
    expect(finalState.nodes['step2'].output?.text).toBe('done-2')
    expect(finalState.nodes['step3'].output?.text).toBe('done-3')

    // step1 was called exactly once across both runs
    expect(partialRunner.calls.filter((c) => c.nodeId === 'step1')).toHaveLength(1)
    expect(freshRunner.calls.filter((c) => c.nodeId === 'step1')).toHaveLength(0)

    // Fresh executor's event stream contains resume events (no run:started)
    const resumeStarted = freshSink.ofType('node:started')
    expect(resumeStarted).toHaveLength(2)
    expect(resumeStarted.map((e) => e.nodeId).sort()).toEqual(['step2', 'step3'])

    const resumeSucceeded = freshSink.ofType('node:succeeded')
    expect(resumeSucceeded).toHaveLength(2)

    const resumeFinished = freshSink.ofType('run:finished')
    expect(resumeFinished).toHaveLength(1)
    expect(resumeFinished[0].status).toBe('succeeded')
  })
})
