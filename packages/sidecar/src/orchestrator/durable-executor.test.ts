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

const simpleDef: WorkflowDef = {
  id: 'wf-simple',
  name: 'Simple',
  nodes: [
    { type: 'agent', id: 'n1', agentId: 'a1', inputTemplate: 'step 1' },
    { type: 'agent', id: 'n2', agentId: 'a1', inputTemplate: '{{n1}}' },
  ],
  edges: [{ from: 'n1', to: 'n2' }],
  entry: ['n1'],
}

describe('DurableExecutor', () => {
  let db: ReturnType<typeof createTestDb>
  let store: SqliteWorkflowStore

  beforeEach(() => {
    db = createTestDb()
    store = new SqliteWorkflowStore(db)
  })

  afterEach(() => db.close())

  it('executes a simple sequential workflow', async () => {
    const runner = new FakeAgentRunner({
      n1: { text: 'result-1' },
      n2: { text: 'result-2' },
    })
    const sink = new CollectingEventSink()
    const executor = new DurableExecutor(store)

    const ctrl = new AbortController()
    const state = await executor.runWorkflow(
      simpleDef,
      { agentRunner: runner, eventSink: sink },
      { runId: 'r-seq', signal: ctrl.signal },
    )

    expect(state.status).toBe('succeeded')
    expect(state.nodes['n1'].status).toBe('succeeded')
    expect(state.nodes['n2'].status).toBe('succeeded')
  })

  it('persists state after each node and can resume', async () => {
    const runner = new FakeAgentRunner({
      n1: { text: 'result-1' },
      n2: { text: 'result-2' },
    })
    const executor = new DurableExecutor(store)

    // First execution completes
    const ctrl = new AbortController()
    await executor.runWorkflow(
      simpleDef,
      { agentRunner: runner },
      { runId: 'r-resume', signal: ctrl.signal },
    )

    // Verify persistence
    const saved = await store.loadRun('r-resume')
    expect(saved).not.toBeNull()
    expect(saved!.status).toBe('succeeded')

    // Replay events
    const events = store.replayEvents('r-resume')
    expect(events.length).toBeGreaterThanOrEqual(4) // started + 2x started/succeeded + finished
  })

  it('fail-fast on node error', async () => {
    const runner = new FakeAgentRunner({
      n1: { throws: 'simulated failure' },
      n2: { text: 'never runs' },
    })
    const executor = new DurableExecutor(store)
    const ctrl = new AbortController()

    const state = await executor.runWorkflow(
      simpleDef,
      { agentRunner: runner },
      { runId: 'r-fail', signal: ctrl.signal },
    )

    expect(state.status).toBe('failed')
    expect(state.nodes['n1'].status).toBe('failed')
    // n2 should be skipped (cascaded)
    expect(state.nodes['n2'].status).toBe('skipped')
  })
})
