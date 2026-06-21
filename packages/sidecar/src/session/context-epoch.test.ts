import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../persistence/open.js'
import type { DatabaseSync } from '../persistence/sqlite.js'
import {
  ContextEpoch,
  RevisionMismatchError,
  LocationMismatchError,
  EpochNotFoundError,
  EpochAlreadyExistsError,
} from './context-epoch.js'
import { SystemContext } from './system-context.js'
import type { Codec, JsonValue, Source } from './system-context.js'

function freshDb(): DatabaseSync {
  const { db } = openDatabase(':memory:')
  return db
}

// ── Test helpers ──────────────────────────────────────────────────────────────

interface MutableStringSource {
  readonly source: Source<string>
  setValue(v: string): void
}

function makeStringSource(key: string, initial: string): MutableStringSource {
  let current = initial
  const codec: Codec<string> = {
    encode: (a: string): JsonValue => a,
    decode: (j: JsonValue): string => (typeof j === 'string' ? j : ''),
  }
  return {
    source: {
      key,
      codec,
      load: async () => current,
      baseline: (v: string) => `${key} = ${v}`,
      update: (prev: string, curr: string) => `${key}: ${prev} -> ${curr}`,
    },
    setValue: (v: string) => {
      current = v
    },
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ContextEpoch.initialize', () => {
  let db: DatabaseSync
  let epoch: ContextEpoch

  beforeEach(() => {
    db = freshDb()
    epoch = new ContextEpoch(db)
  })

  // Test 1: initialize → epoch row created with revision=0
  it('creates an epoch row at revision 0 that passes the fence check', () => {
    epoch.initialize('s1', 'agent', { cwd: '/home' }, 'baseline text', {}, 1)

    // Fence passes only with the exact (agent, revision) pair.
    expect(epoch.current('s1', 'agent', 0)).toBe(true)
    expect(epoch.current('s1', 'agent', 1)).toBe(false)
    expect(epoch.current('s1', 'other', 0)).toBe(false)
    expect(epoch.current('s2', 'agent', 0)).toBe(false)
  })

  it('persists baseline, snapshot, agent, baseline_seq, and location in the row', () => {
    const snapshot = { 'core/a': { value: 'A1' } }
    epoch.initialize('s1', 'my-agent', { cwd: '/work' }, 'base line', snapshot, 7)

    const row = db
      .prepare(
        'SELECT baseline, agent, snapshot, baseline_seq, replacement_seq, revision, location FROM session_context_epoch WHERE session_id = ?',
      )
      .get('s1') as {
        baseline: string
        agent: string
        snapshot: string
        baseline_seq: number
        replacement_seq: number | null
        revision: number
        location: string
      }

    expect(row.baseline).toBe('base line')
    expect(row.agent).toBe('my-agent')
    expect(JSON.parse(row.snapshot)).toEqual(snapshot)
    expect(row.baseline_seq).toBe(7)
    expect(row.replacement_seq).toBeNull()
    expect(row.revision).toBe(0)
    expect(row.location).toBe('/work')
  })

  it('throws EpochAlreadyExistsError if a row already exists for the session', () => {
    epoch.initialize('s1', 'agent', { cwd: '/a' }, 'b', {}, 1)
    expect(() => epoch.initialize('s1', 'agent', { cwd: '/a' }, 'b2', {}, 2)).toThrow(
      EpochAlreadyExistsError,
    )
  })
})

describe('ContextEpoch.prepare', () => {
  let db: DatabaseSync
  let epoch: ContextEpoch

  beforeEach(() => {
    db = freshDb()
    epoch = new ContextEpoch(db)
  })

  // Test 2: prepare with same agent + unchanged sources → { action: 'unchanged' }
  it('returns unchanged when the same agent reconciles with no source drift', async () => {
    const holder = makeStringSource('core/a', 'A1')
    const ctx = new SystemContext([holder.source])
    const gen = await ctx.initialize()
    epoch.initialize('s1', 'agent', { cwd: '/work' }, gen.baseline, gen.snapshot, 1)

    const result = await epoch.prepare('s1', 'agent', ctx, { cwd: '/work' })

    expect(result).toEqual({ action: 'unchanged' })
    // Revision unchanged.
    expect(epoch.current('s1', 'agent', 0)).toBe(true)
  })

  // Test 3: prepare with same agent + changed source → { action: 'updated', revision+1 }
  it('returns updated with bumped revision when a source value drifts', async () => {
    const holder = makeStringSource('core/a', 'A1')
    const ctx = new SystemContext([holder.source])
    const gen = await ctx.initialize()
    epoch.initialize('s1', 'agent', { cwd: '/work' }, gen.baseline, gen.snapshot, 1)

    holder.setValue('A2')
    const result = await epoch.prepare('s1', 'agent', ctx, { cwd: '/work' })

    expect(result.action).toBe('updated')
    if (result.action !== 'updated') return
    expect(result.messages).toEqual(['core/a: A1 -> A2'])
    expect(result.revision).toBe(1)

    // Old fence fails, new fence passes.
    expect(epoch.current('s1', 'agent', 0)).toBe(false)
    expect(epoch.current('s1', 'agent', 1)).toBe(true)

    // Snapshot persisted — a second prepare with no further drift is unchanged.
    const second = await epoch.prepare('s1', 'agent', ctx, { cwd: '/work' })
    expect(second).toEqual({ action: 'unchanged' })
  })

  // Test 4: prepare with different agent → { action: 'replace' }
  it('returns replace with a fresh generation when the agent changed', async () => {
    const holder = makeStringSource('core/a', 'A1')
    const ctx = new SystemContext([holder.source])
    const gen = await ctx.initialize()
    epoch.initialize('s1', 'agent-a', { cwd: '/work' }, gen.baseline, gen.snapshot, 1)

    const result = await epoch.prepare('s1', 'agent-b', ctx, { cwd: '/work' })

    expect(result.action).toBe('replace')
    if (result.action !== 'replace') return
    expect(result.generation.baseline).toBe('core/a = A1')
    expect(result.generation.snapshot['core/a']).toEqual({ value: 'A1' })

    // Epoch now reflects agent-b at revision 1.
    expect(epoch.current('s1', 'agent-a', 0)).toBe(false)
    expect(epoch.current('s1', 'agent-b', 1)).toBe(true)

    // A second prepare with agent-b + no drift is unchanged.
    const second = await epoch.prepare('s1', 'agent-b', ctx, { cwd: '/work' })
    expect(second).toEqual({ action: 'unchanged' })
  })

  // Test 5: concurrent prepare with stale revision → RevisionMismatch error
  it('throws RevisionMismatchError when revision changed during the async reconcile window', async () => {
    const holder = makeStringSource('core/a', 'A1')
    const ctx = new SystemContext([holder.source])
    const gen = await ctx.initialize()
    epoch.initialize('s1', 'agent', { cwd: '/work' }, gen.baseline, gen.snapshot, 1)

    // A source whose load() bumps the epoch revision the first time it runs,
    // simulating a concurrent writer winning the race during reconcile.
    let raced = false
    const racingSource: Source<string> = {
      key: 'core/a',
      codec: {
        encode: (a: string): JsonValue => a,
        decode: (j: JsonValue): string => (typeof j === 'string' ? j : ''),
      },
      load: async () => {
        if (!raced) {
          raced = true
          db.prepare(
            'UPDATE session_context_epoch SET revision = revision + 1 WHERE session_id = ?',
          ).run('s1')
        }
        return 'A2'
      },
      baseline: (v: string) => `core/a = ${v}`,
      update: (p: string, c: string) => `core/a: ${p} -> ${c}`,
    }
    const racingCtx = new SystemContext([racingSource])

    // prepare reads revision=0; reconcile's load() bumps it to 1; the optimistic
    // UPDATE ... WHERE revision = 0 matches 0 rows → RevisionMismatchError.
    await expect(epoch.prepare('s1', 'agent', racingCtx, { cwd: '/work' })).rejects.toThrow(
      RevisionMismatchError,
    )
  })

  // Test 6: Location mismatch (cwd ≠ location.cwd) → error
  it('throws LocationMismatchError when the caller cwd differs from the epoch location', async () => {
    const holder = makeStringSource('core/a', 'A1')
    const ctx = new SystemContext([holder.source])
    const gen = await ctx.initialize()
    epoch.initialize('s1', 'agent', { cwd: '/original' }, gen.baseline, gen.snapshot, 1)

    await expect(
      epoch.prepare('s1', 'agent', ctx, { cwd: '/moved' }),
    ).rejects.toThrow(LocationMismatchError)
  })

  it('throws EpochNotFoundError when prepare is called without initialize', async () => {
    const holder = makeStringSource('core/a', 'A1')
    const ctx = new SystemContext([holder.source])

    await expect(
      epoch.prepare('s1', 'agent', ctx, { cwd: '/work' }),
    ).rejects.toThrow(EpochNotFoundError)
  })

  // Test 7: requestReplacement → replacement_seq set → next prepare triggers replace
  it('triggers replace on the next prepare after requestReplacement', async () => {
    const holder = makeStringSource('core/a', 'A1')
    const ctx = new SystemContext([holder.source])
    const gen = await ctx.initialize()
    epoch.initialize('s1', 'agent', { cwd: '/work' }, gen.baseline, gen.snapshot, 5)

    epoch.requestReplacement('s1', 12)

    // The row now has replacement_seq = 12.
    const row = db
      .prepare('SELECT replacement_seq FROM session_context_epoch WHERE session_id = ?')
      .get('s1') as { replacement_seq: number | null }
    expect(row.replacement_seq).toBe(12)

    const result = await epoch.prepare('s1', 'agent', ctx, { cwd: '/work' })

    expect(result.action).toBe('replace')
    if (result.action !== 'replace') return
    expect(result.generation.baseline).toBe('core/a = A1')

    // replacement_seq cleared, baseline_seq advanced to the replacement seq,
    // revision bumped.
    const after = db
      .prepare(
        'SELECT baseline_seq, replacement_seq, revision FROM session_context_epoch WHERE session_id = ?',
      )
      .get('s1') as { baseline_seq: number; replacement_seq: number | null; revision: number }
    expect(after.baseline_seq).toBe(12)
    expect(after.replacement_seq).toBeNull()
    expect(after.revision).toBe(1)
  })

  it('returns unchanged when a replacement is needed but a source is blocked', async () => {
    const holder = makeStringSource('core/a', 'A1')
    const ctx = new SystemContext([holder.source])
    const gen = await ctx.initialize()
    epoch.initialize('s1', 'agent', { cwd: '/work' }, gen.baseline, gen.snapshot, 1)

    epoch.requestReplacement('s1', 9)

    const throwingSource: Source<string> = {
      key: 'core/a',
      codec: {
        encode: (a: string): JsonValue => a,
        decode: (j: JsonValue): string => (typeof j === 'string' ? j : ''),
      },
      load: async () => {
        throw new Error('disk gone')
      },
      baseline: (v: string) => `core/a = ${v}`,
    }
    const blockedCtx = new SystemContext([throwingSource])

    const result = await epoch.prepare('s1', 'agent', blockedCtx, { cwd: '/work' })

    // ReplacementBlocked → falls back to unchanged. Pending flag stays.
    expect(result).toEqual({ action: 'unchanged' })

    // replacement_seq NOT cleared — next prepare will retry.
    const row = db
      .prepare('SELECT replacement_seq, revision FROM session_context_epoch WHERE session_id = ?')
      .get('s1') as { replacement_seq: number | null; revision: number }
    expect(row.replacement_seq).toBe(9)
    expect(row.revision).toBe(0)
  })
})

describe('ContextEpoch.reset', () => {
  let db: DatabaseSync
  let epoch: ContextEpoch

  beforeEach(() => {
    db = freshDb()
    epoch = new ContextEpoch(db)
  })

  // Test 8: reset → row deleted
  it('deletes the epoch row so the fence fails and initialize can run again', () => {
    epoch.initialize('s1', 'agent', { cwd: '/home' }, 'b', {}, 1)
    expect(epoch.current('s1', 'agent', 0)).toBe(true)

    epoch.reset('s1')

    expect(epoch.current('s1', 'agent', 0)).toBe(false)

    // After reset, initialize can create a fresh epoch.
    expect(() =>
      epoch.initialize('s1', 'agent', { cwd: '/new' }, 'b2', {}, 2),
    ).not.toThrow()
    expect(epoch.current('s1', 'agent', 0)).toBe(true)
  })

  it('reset on a non-existent session is a no-op', () => {
    expect(() => epoch.reset('never')).not.toThrow()
  })
})

describe('ContextEpoch.requestReplacement', () => {
  let db: DatabaseSync
  let epoch: ContextEpoch

  beforeEach(() => {
    db = freshDb()
    epoch = new ContextEpoch(db)
  })

  it('sets replacement_seq to the given seq', () => {
    epoch.initialize('s1', 'agent', { cwd: '/a' }, 'b', {}, 1)
    epoch.requestReplacement('s1', 42)

    const row = db
      .prepare('SELECT replacement_seq FROM session_context_epoch WHERE session_id = ?')
      .get('s1') as { replacement_seq: number | null }
    expect(row.replacement_seq).toBe(42)
  })

  it('does not bump revision (replacement_seq is just a flag)', () => {
    epoch.initialize('s1', 'agent', { cwd: '/a' }, 'b', {}, 1)
    epoch.requestReplacement('s1', 42)

    expect(epoch.current('s1', 'agent', 0)).toBe(true)
  })

  it('is a no-op on a non-existent session (no row to update)', () => {
    expect(() => epoch.requestReplacement('never', 1)).not.toThrow()
  })
})

// ── Migration coexistence ─────────────────────────────────────────────────────

describe('session_context_epoch migration', () => {
  it('creates the table alongside existing tables without dropping them', () => {
    const db = freshDb()
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as { name: string }[]
    const names = tables.map((t) => t.name)

    expect(names).toEqual(
      expect.arrayContaining([
        'sessions',
        'messages',
        'event',
        'event_sequence',
        'snapshots',
        'session_message',
        'session_context_epoch',
      ]),
    )
  })

  it('has a location column for the session-move fence', () => {
    const db = freshDb()
    const cols = db
      .prepare(`PRAGMA table_info(session_context_epoch)`)
      .all() as { name: string }[]
    const names = cols.map((c) => c.name)

    expect(names).toEqual(
      expect.arrayContaining([
        'session_id',
        'baseline',
        'agent',
        'snapshot',
        'baseline_seq',
        'replacement_seq',
        'revision',
        'location',
      ]),
    )
  })
})
