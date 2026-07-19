import { describe, expect, it } from 'vitest'
import { resolveWorktreeOpenTarget } from './worktreeOpenTarget'

const nested = (ids: string[]) => new Set(ids)

describe('resolveWorktreeOpenTarget', () => {
  it('1. isPrimary → select hostSessionId', () => {
    const t = resolveWorktreeOpenTarget({
      path: '/repo',
      hostSessionId: 'host',
      isPrimary: true,
      sessions: [{ id: 'host', title: 'H', config: { cwd: '/repo' } }],
      nestedSessionIds: nested([]),
    })
    expect(t).toEqual({ kind: 'select', sessionId: 'host' })
  })

  it('2. slotSessionId present and exists → select slot', () => {
    const t = resolveWorktreeOpenTarget({
      path: '/wt/a',
      hostSessionId: 'host',
      slotSessionId: 'slot-a',
      sessions: [
        { id: 'host', title: 'H', config: { cwd: '/repo' } },
        { id: 'slot-a', title: 'A', config: { cwd: '/wt/a' } },
      ],
      nestedSessionIds: nested(['slot-a']),
    })
    expect(t).toEqual({ kind: 'select', sessionId: 'slot-a' })
  })

  it('2b. slotSessionId missing from sessions → fall through', () => {
    const t = resolveWorktreeOpenTarget({
      path: '/wt/a',
      hostSessionId: 'host',
      slotSessionId: 'gone',
      sessions: [{ id: 'host', title: 'H', config: { cwd: '/repo' } }],
      nestedSessionIds: nested([]),
    })
    expect(t).toEqual({ kind: 'none', reason: 'no_session' })
  })

  it('3. boundSessionId when present → select', () => {
    const t = resolveWorktreeOpenTarget({
      path: '/wt/a',
      hostSessionId: 'host',
      boundSessionId: 'bound',
      sessions: [
        { id: 'host', title: 'H', config: { cwd: '/repo' } },
        { id: 'bound', title: 'B', config: { cwd: '/wt/a' } },
      ],
      nestedSessionIds: nested(['bound']),
    })
    expect(t).toEqual({ kind: 'select', sessionId: 'bound' })
  })

  it('4. prefer nested + running over idle', () => {
    const t = resolveWorktreeOpenTarget({
      path: '/wt/a',
      hostSessionId: 'host',
      sessions: [
        { id: 'idle-n', title: 'I', config: { cwd: '/wt/a' }, status: 'idle', updatedAtMs: 100 },
        {
          id: 'run-n',
          title: 'R',
          config: { cwd: '/wt/a' },
          status: 'running',
          updatedAtMs: 50,
        },
        { id: 'other', title: 'O', config: { cwd: '/other' }, status: 'running' },
      ],
      nestedSessionIds: nested(['idle-n', 'run-n']),
    })
    expect(t).toEqual({ kind: 'select', sessionId: 'run-n' })
  })

  it('4b. prefer max updatedAtMs when no running', () => {
    const t = resolveWorktreeOpenTarget({
      path: '/wt/a',
      hostSessionId: 'host',
      sessions: [
        { id: 'a', title: 'A', config: { cwd: '/wt/a' }, status: 'idle', updatedAtMs: 10 },
        { id: 'b', title: 'B', config: { cwd: '/wt/a' }, status: 'idle', updatedAtMs: 99 },
      ],
      nestedSessionIds: nested(['a', 'b']),
    })
    expect(t).toEqual({ kind: 'select', sessionId: 'b' })
  })

  it('4c. stable sort by id when no status/updatedAtMs', () => {
    const t = resolveWorktreeOpenTarget({
      path: '/wt/a',
      hostSessionId: 'host',
      sessions: [
        { id: 'z-sess', title: 'Z', config: { cwd: '/wt/a' } },
        { id: 'a-sess', title: 'A', config: { cwd: '/wt/a' } },
      ],
      nestedSessionIds: nested(['z-sess', 'a-sess']),
    })
    expect(t).toEqual({ kind: 'select', sessionId: 'a-sess' })
  })

  it('4d. prefer nested over non-nested cwd match', () => {
    const t = resolveWorktreeOpenTarget({
      path: '/wt/a',
      hostSessionId: 'host',
      sessions: [
        { id: 'top', title: 'T', config: { cwd: '/wt/a' }, status: 'running', updatedAtMs: 999 },
        { id: 'nested', title: 'N', config: { cwd: '/wt/a' }, status: 'idle', updatedAtMs: 1 },
      ],
      nestedSessionIds: nested(['nested']),
    })
    expect(t).toEqual({ kind: 'select', sessionId: 'nested' })
  })

  it('5. slotTaskId only → agent_task_only', () => {
    const t = resolveWorktreeOpenTarget({
      path: '/wt/a',
      hostSessionId: 'host',
      slotTaskId: 'task-1',
      sessions: [{ id: 'host', title: 'H', config: { cwd: '/repo' } }],
      nestedSessionIds: nested([]),
    })
    expect(t).toEqual({ kind: 'none', reason: 'agent_task_only' })
  })

  it('6. no session → no_session', () => {
    const t = resolveWorktreeOpenTarget({
      path: '/wt/a',
      hostSessionId: 'host',
      sessions: [{ id: 'host', title: 'H', config: { cwd: '/repo' } }],
      nestedSessionIds: nested([]),
    })
    expect(t).toEqual({ kind: 'none', reason: 'no_session' })
  })

  it('pathKey normalizes trailing slash for cwd match', () => {
    const t = resolveWorktreeOpenTarget({
      path: '/wt/a/',
      hostSessionId: 'host',
      sessions: [
        { id: 's1', title: 'S', config: { cwd: '/wt/a' }, status: 'idle' },
      ],
      nestedSessionIds: nested(['s1']),
    })
    expect(t).toEqual({ kind: 'select', sessionId: 's1' })
  })
})
