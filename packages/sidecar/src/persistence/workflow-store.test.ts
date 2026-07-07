import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseSync } from './sqlite.js'
import { SqliteWorkflowStore } from './workflow-store.js'
import { WORKFLOW_DDL } from './schema.js'
import type { WorkflowDef, OrchestratorEvent } from '@hip/protocol'

function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  for (const ddl of WORKFLOW_DDL) db.exec(ddl)
  return db
}

const sampleDef: WorkflowDef = {
  id: 'wf-1',
  name: 'Test Workflow',
  nodes: [{ type: 'agent', id: 'n1', agentId: 'a1', inputTemplate: 'hello' }],
  edges: [],
  entry: ['n1'],
}

describe('SqliteWorkflowStore', () => {
  let db: DatabaseSync
  let store: SqliteWorkflowStore

  beforeEach(() => {
    db = createTestDb()
    store = new SqliteWorkflowStore(db)
  })

  afterEach(() => db.close())

  it('saves and loads a workflow definition', async () => {
    await store.saveDef(sampleDef)
    const loaded = await store.loadDef('wf-1')
    expect(loaded).toEqual(sampleDef)
  })

  it('returns null for unknown def', async () => {
    const loaded = await store.loadDef('nonexistent')
    expect(loaded).toBeNull()
  })

  it('saves run state and loads it back', async () => {
    // Must save the def first as workflow_runs has FK reference
    await store.saveDef(sampleDef)
    const state = {
      runId: 'r1',
      workflowId: 'wf-1',
      status: 'running' as const,
      nodes: { n1: { status: 'ready' as const } },
    }
    await store.saveRun(state)
    const loaded = await store.loadRun('r1')
    expect(loaded).toEqual(state)
  })

  it('appendEvent and replayEvents preserve order', async () => {
    // Must have def and run rows first (FK references)
    await store.saveDef(sampleDef)
    await store.saveRun({
      runId: 'r1',
      workflowId: 'wf-1',
      status: 'running',
      nodes: {},
    })
    const events: OrchestratorEvent[] = [
      { type: 'run:started' },
      { type: 'node:started', nodeId: 'n1' },
      { type: 'node:succeeded', nodeId: 'n1', output: { text: 'done' } },
      { type: 'run:finished', status: 'succeeded' },
    ]
    for (const e of events) store.appendEvent('r1', e)
    const replayed = store.replayEvents('r1')
    expect(replayed).toEqual(events)
  })

  it('deleteRun removes all run data', async () => {
    // Must have def and run rows first (FK references)
    await store.saveDef(sampleDef)
    await store.saveRun({
      runId: 'r1',
      workflowId: 'wf-1',
      status: 'running',
      nodes: {},
    })
    store.appendEvent('r1', { type: 'run:started' })
    store.deleteRun('r1')
    expect(store.replayEvents('r1')).toEqual([])
    await expect(store.loadRun('r1')).resolves.toBeNull()
  })
})
