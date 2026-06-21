import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'
import { prepareSessionContext } from './session-context.js'

function freshStore(): SessionStore {
  const { db, ftsEnabled } = openDatabase(':memory:')
  return new SessionStore(db, ftsEnabled)
}

const baseState = {
  cwd: '/tmp/project',
  customSystemPrompt: undefined,
  skills: [],
  permissionMode: 'edit' as const,
  mcpCatalog: undefined,
  tokenBudgetPercent: 100,
  pendingSubagents: undefined,
  completedSubagents: undefined,
  checkpointId: undefined,
}

describe('prepareSessionContext', () => {
  it('returns baseline and no context messages when no store is provided', async () => {
    const prepared = await prepareSessionContext('s1', 'supervisor', baseState, undefined)

    expect(prepared.system.length).toBeGreaterThan(0)
    expect(prepared.contextMessages).toHaveLength(0)
  })

  it('initializes an epoch on first call with a store', async () => {
    const store = freshStore()

    const first = await prepareSessionContext('s1', 'supervisor', baseState, store)

    expect(first.system.length).toBeGreaterThan(0)
    expect(first.contextMessages).toHaveLength(0)

    const row = store.getDb()
      .prepare('SELECT agent, location FROM session_context_epoch WHERE session_id = ?')
      .get('s1') as { agent: string; location: string }
    expect(row.agent).toBe('supervisor')
    expect(row.location).toBe('/tmp/project')
  })

  it('returns updated context messages when sources change between turns', async () => {
    const store = freshStore()

    await prepareSessionContext('s1', 'supervisor', baseState, store)

    // Advance time by changing the token budget; the time fragment will also
    // have moved forward, so the epoch should detect a source change.
    const second = await prepareSessionContext('s1', 'supervisor', {
      ...baseState,
      tokenBudgetPercent: 50,
    }, store)

    expect(second.contextMessages.length).toBeGreaterThan(0)
  })

  it('replaces the epoch when requestReplace is true', async () => {
    const store = freshStore()

    await prepareSessionContext('s1', 'supervisor', baseState, store)

    const replaced = await prepareSessionContext('s1', 'supervisor', baseState, store, true)

    expect(replaced.contextMessages).toHaveLength(0)
  })

  it('resets the epoch when the cwd (location) changes', async () => {
    const store = freshStore()

    await prepareSessionContext('s1', 'supervisor', baseState, store)

    const moved = await prepareSessionContext('s1', 'supervisor', {
      ...baseState,
      cwd: '/tmp/other',
    }, store)

    expect(moved.system.length).toBeGreaterThan(0)

    const row = store.getDb()
      .prepare('SELECT location FROM session_context_epoch WHERE session_id = ?')
      .get('s1') as { location: string }
    expect(row.location).toBe('/tmp/other')
  })
})
