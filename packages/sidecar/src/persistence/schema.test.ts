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
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(16)
    expect(columns(db, 'messages')).toContain('attachments')
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
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(16)
  })

  it('v10 adds event_sequence + event + snapshots tables and reaches user_version 10', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    expect(columns(db, 'event_sequence')).toEqual(expect.arrayContaining(['aggregate_id', 'seq', 'owner_id']))
    expect(columns(db, 'event')).toEqual(
      expect.arrayContaining(['id', 'aggregate_id', 'seq', 'type', 'data']),
    )
    expect(columns(db, 'snapshots')).toEqual(
      expect.arrayContaining(['session_id', 'seq', 'state', 'timestamp']),
    )
    const indexes = (db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='event'`).all() as { name: string }[]).map((r) => r.name)
    expect(indexes).toEqual(expect.arrayContaining(['idx_event_aggregate_seq', 'idx_event_aggregate_type_seq']))
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(16)
  })

  it('v10 migration preserves all pre-existing tables (no drop / no rename)', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]).map((t) => t.name)
    expect(tables).toEqual(expect.arrayContaining(['sessions', 'messages', 'agent_runs', 'tool_calls', 'checkpoints']))
  })

  it('v11 adds session_message projection table and reaches user_version 11', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    expect(columns(db, 'session_message')).toEqual(
      expect.arrayContaining(['id', 'session_id', 'type', 'seq', 'time_created', 'time_updated', 'data']),
    )
    const indexes = (db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='session_message'`).all() as { name: string }[]).map((r) => r.name)
    expect(indexes).toEqual(expect.arrayContaining(['idx_session_message_session_seq', 'idx_session_message_session_type_seq']))
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(16)
  })

  it('v13 adds session_input queue table and reaches user_version 13', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    expect(columns(db, 'session_input')).toEqual(
      expect.arrayContaining(['id', 'session_id', 'prompt', 'delivery', 'admitted_seq', 'promoted_seq', 'time_created']),
    )
    const indexes = (db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='session_input'`).all() as { name: string }[]).map((r) => r.name)
    expect(indexes).toEqual(expect.arrayContaining(['idx_session_input_session', 'idx_session_input_session_promoted']))
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(16)
  })

  it('v14 adds cron_tasks table and reaches user_version 14', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    expect(columns(db, 'cron_tasks')).toEqual(
      expect.arrayContaining(['id', 'session_id', 'prompt', 'schedule_type', 'schedule_at', 'schedule_interval_ms', 'next_fire_at', 'created_at']),
    )
    const indexes = (db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='cron_tasks'`).all() as { name: string }[]).map((r) => r.name)
    expect(indexes).toEqual(expect.arrayContaining(['idx_cron_tasks_session']))
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(16)
  })

  it('v15 adds messages.attachments column', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    expect(columns(db, 'messages')).toContain('attachments')
  })

  it('v16 adds memory_items / memory_summaries / memory_stage1 / memory_jobs and reaches user_version 16', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    expect(columns(db, 'memory_items')).toEqual(
      expect.arrayContaining([
        'id', 'scope', 'project_key', 'project_key_hash', 'session_id', 'kind',
        'title', 'content', 'confidence', 'status', 'source', 'source_session_id',
        'tags_json', 'created_at', 'updated_at', 'last_used_at', 'use_count', 'pinned',
      ]),
    )
    expect(columns(db, 'memory_summaries')).toEqual(
      expect.arrayContaining(['id', 'scope', 'project_key', 'project_key_hash', 'summary_md', 'updated_at']),
    )
    expect(columns(db, 'memory_stage1')).toEqual(
      expect.arrayContaining([
        'id', 'session_id', 'project_key', 'project_key_hash', 'cwd', 'raw_memory',
        'rollout_summary', 'rollout_slug', 'status', 'selected_for_phase2',
        'lease_owner', 'lease_until', 'retry_after', 'source_updated_at', 'created_at',
      ]),
    )
    expect(columns(db, 'memory_jobs')).toEqual(
      expect.arrayContaining(['id', 'kind', 'watermark', 'lease_owner', 'lease_until', 'last_error', 'updated_at']),
    )
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(16)
  })
})
