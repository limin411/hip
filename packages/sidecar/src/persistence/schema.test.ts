import { describe, it, expect } from 'vitest'
import { DatabaseSync } from './sqlite.js'
import { migrate } from './schema.js'

function columns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)
}

describe('migrate', () => {
  it('adds tool_calls + agent_runs delegation + token columns + messages.timeline + sessions.diff_base_sha and reaches user_version 7', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    expect(columns(db, 'sessions')).toContain('title_custom')
    expect(columns(db, 'sessions')).toContain('diff_base_sha')
    expect(columns(db, 'messages')).toContain('stopped')
    expect(columns(db, 'messages')).toContain('timeline')
    expect(columns(db, 'agent_runs')).toEqual(expect.arrayContaining(['task_input', 'parent_agent_id']))
    expect(columns(db, 'agent_runs')).toEqual(
      expect.arrayContaining(['prompt_tokens', 'completion_tokens', 'total_tokens']),
    )
    expect(columns(db, 'tool_calls')).toEqual(
      expect.arrayContaining(['agent_run_id', 'call_id', 'agent_id', 'name', 'input', 'output', 'status', 'error', 'seq', 'truncated']),
    )
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(9)
  })

  it('is idempotent and upgrades an existing v1 database in place', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    migrate(db) // second run must not throw (e.g. duplicate column)
    expect(columns(db, 'sessions').filter((c) => c === 'title_custom')).toHaveLength(1)
    expect(columns(db, 'messages').filter((c) => c === 'stopped')).toHaveLength(1)
    expect(columns(db, 'agent_runs').filter((c) => c === 'task_input')).toHaveLength(1)
  })

  it('v8 adds the checkpoints table + sessions.current_branch/session_start_commit', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    expect(columns(db, 'sessions')).toEqual(expect.arrayContaining(['current_branch', 'session_start_commit']))
    expect(columns(db, 'checkpoints')).toEqual(
      expect.arrayContaining(['id', 'session_id', 'turn_id', 'kind', 'label', 'tree_sha', 'commit_sha', 'branch', 'created_at']),
    )
  })

  it('v9 adds sessions.acp_session_id and reaches user_version 9', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    expect(columns(db, 'sessions')).toContain('acp_session_id')
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(9)
  })
})
