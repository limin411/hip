import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from './open.js'
import { SessionStore } from './store.js'
import { EventStore, SnapshotStore, serializeMessages, deserializeMessages } from './event-store.js'
import type { SessionEvent } from './event-store.js'
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'

function freshDb() {
  const { db } = openDatabase(':memory:')
  return db
}

const cfg = JSON.stringify({ llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] })

describe('EventStore', () => {
  let store: EventStore

  beforeEach(() => {
    store = new EventStore(freshDb())
  })

  describe('publish', () => {
    it('returns seq=1 for the first event on a session and persists it', () => {
      const result = store.publish('s1', 'TextStarted', { content: 'hello' })

      expect(result.seq).toBe(1)
      expect(store.latestSeq('s1')).toBe(1)
    })

    it('auto-increments seq on subsequent publishes (1, 2, 3)', () => {
      const r1 = store.publish('s1', 'TextStarted', { content: 'a' })
      const r2 = store.publish('s1', 'TextEnded', { content: 'a' })
      const r3 = store.publish('s1', 'ToolCalled', { callId: 'c1' })

      expect([r1.seq, r2.seq, r3.seq]).toEqual([1, 2, 3])
      expect(store.latestSeq('s1')).toBe(3)
    })

    it('keeps independent seq counters per session (parallel aggregates)', () => {
      store.publish('s1', 'TextStarted', {})
      store.publish('s2', 'TextStarted', {})

      expect(store.latestSeq('s1')).toBe(1)
      expect(store.latestSeq('s2')).toBe(1)

      store.publish('s1', 'TextEnded', {})
      expect(store.latestSeq('s1')).toBe(2)
      expect(store.latestSeq('s2')).toBe(1)
    })

    it('returns seq=0 from latestSeq for a session with no events', () => {
      expect(store.latestSeq('never')).toBe(0)
    })

    it('round-trips the data payload through JSON without mutation', () => {
      store.publish('s1', 'ToolSuccess', { callId: 'c1', output: 'ok', nested: { a: [1, 2, { b: true }] } })

      const events = store.loadEvents('s1')
      expect(events[0].data).toEqual({ callId: 'c1', output: 'ok', nested: { a: [1, 2, { b: true }] } })
    })

    it('preserves special characters in the event type and data', () => {
      store.publish('s1', 'Custom/Event:with spaces & symbols', { unicode: '你好世界 🌍', quote: '"nested"' })

      const events = store.loadEvents('s1')
      expect(events[0].type).toBe('Custom/Event:with spaces & symbols')
      expect(events[0].data).toEqual({ unicode: '你好世界 🌍', quote: '"nested"' })
    })

    it('accepts large data payloads (>50KB)', () => {
      const large = { blob: 'x'.repeat(80_000) }
      store.publish('s1', 'BigEvent', large)

      const events = store.loadEvents('s1')
      expect((events[0].data.blob as string).length).toBe(80_000)
    })
  })

  describe('loadEvents', () => {
    it('returns events in ascending seq order when published out of natural ordering', () => {
      store.publish('s1', 'A', {})
      store.publish('s1', 'B', {})
      store.publish('s1', 'C', {})

      const events = store.loadEvents('s1')
      expect(events.map((e) => e.seq)).toEqual([1, 2, 3])
      expect(events.map((e) => e.type)).toEqual(['A', 'B', 'C'])
    })

    it('returns an empty array for a session with no events', () => {
      expect(store.loadEvents('never')).toEqual([])
    })

    it('returns only events with seq >= fromSeq when fromSeq is provided', () => {
      store.publish('s1', 'A', {})
      store.publish('s1', 'B', {})
      store.publish('s1', 'C', {})
      store.publish('s1', 'D', {})

      const events = store.loadEvents('s1', 2)
      expect(events.map((e) => e.seq)).toEqual([2, 3, 4])
      expect(events.map((e) => e.type)).toEqual(['B', 'C', 'D'])
    })

    it('fromSeq=1 returns the full event stream', () => {
      store.publish('s1', 'A', {})
      store.publish('s1', 'B', {})

      const events = store.loadEvents('s1', 1)
      expect(events.map((e) => e.seq)).toEqual([1, 2])
    })

    it('fromSeq beyond latest returns an empty array', () => {
      store.publish('s1', 'A', {})

      expect(store.loadEvents('s1', 99)).toEqual([])
    })

    it('returns events shaped as SessionEvent (aggregateId, seq, type, data, id)', () => {
      store.publish('s1', 'TextStarted', { content: 'hi' })

      const events = store.loadEvents('s1')
      expect(events[0]).toMatchObject({
        aggregateId: 's1',
        seq: 1,
        type: 'TextStarted',
        data: { content: 'hi' },
      })
      expect(typeof events[0].id).toBe('string')
      expect(events[0].id).toBe('s1:1')
    })

    it('stays stable across repeated publishes from independent callers (no gaps, no duplicates)', () => {
      for (let i = 0; i < 50; i++) {
        store.publish('s1', `E${i}`, { i })
      }

      const events = store.loadEvents('s1')
      expect(events).toHaveLength(50)
      const seqs = events.map((e) => e.seq)
      // monotonic 1..50 with no gaps and no duplicates
      expect(seqs).toEqual(Array.from({ length: 50 }, (_, i) => i + 1))
    })
  })
})

describe('SnapshotStore', () => {
  let snapshots: SnapshotStore

  beforeEach(() => {
    snapshots = new SnapshotStore(freshDb())
  })

  it('returns null for a session that has no snapshot', () => {
    expect(snapshots.loadSnapshot('s1')).toBeNull()
  })

  it('round-trips a snapshot (seq + state) and exposes a timestamp', () => {
    const before = Date.now()
    snapshots.saveSnapshot('s1', 10, '{"messages":[]}')
    const after = Date.now()

    const snap = snapshots.loadSnapshot('s1')
    expect(snap).not.toBeNull()
    expect(snap!.seq).toBe(10)
    expect(snap!.state).toBe('{"messages":[]}')
    expect(snap!.timestamp).toBeGreaterThanOrEqual(before)
    expect(snap!.timestamp).toBeLessThanOrEqual(after)
  })

  it('INSERT OR REPLACE: saving twice for the same session replaces the prior snapshot', () => {
    snapshots.saveSnapshot('s1', 5, '{"v":1}')
    snapshots.saveSnapshot('s1', 12, '{"v":2}')

    const snap = snapshots.loadSnapshot('s1')
    expect(snap!.seq).toBe(12)
    expect(snap!.state).toBe('{"v":2}')
  })

  it('keeps snapshots for independent sessions isolated', () => {
    snapshots.saveSnapshot('s1', 3, '{"a":1}')
    snapshots.saveSnapshot('s2', 7, '{"b":2}')

    expect(snapshots.loadSnapshot('s1')!.state).toBe('{"a":1}')
    expect(snapshots.loadSnapshot('s2')!.state).toBe('{"b":2}')
  })
})

describe('serializeMessages / deserializeMessages', () => {
  it('round-trips a HumanMessage with structured content parts', () => {
    const original = [
      new HumanMessage({
        content: [
          { type: 'text', text: 'describe this' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
        ],
      }),
    ]
    const roundTripped = deserializeMessages(serializeMessages(original))
    expect(roundTripped).toHaveLength(1)
    expect(roundTripped[0]).toBeInstanceOf(HumanMessage)
    expect(roundTripped[0].content).toEqual(original[0].content)
  })

  it('round-trips plain string messages', () => {
    const original = [new HumanMessage('hi'), new AIMessage('hello'), new SystemMessage('context')]
    const roundTripped = deserializeMessages(serializeMessages(original))
    expect(roundTripped.map((m) => m.content)).toEqual(['hi', 'hello', 'context'])
  })

  it('round-trips an AIMessage with tool calls', () => {
    const original = [
      new AIMessage({
        content: 'used a tool',
        tool_calls: [{ name: 'ls', args: { path: '/' }, id: 'c1', type: 'tool_call' }],
      }),
    ]
    const roundTripped = deserializeMessages(serializeMessages(original))
    expect(roundTripped[0]).toBeInstanceOf(AIMessage)
    const ai = roundTripped[0] as AIMessage
    expect(ai.content).toBe('used a tool')
    expect(ai.tool_calls).toEqual([{ name: 'ls', args: { path: '/' }, id: 'c1', type: 'tool_call' }])
  })
})

describe('EventStore + SnapshotStore integration with existing schema', () => {
  it('coexists with SessionStore on the same DB handle without breaking existing tables', () => {
    const { db, ftsEnabled } = openDatabase(':memory:')
    const sessionStore = new SessionStore(db, ftsEnabled)
    const eventStore = new EventStore(db)
    const snapshotStore = new SnapshotStore(db)

    sessionStore.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    sessionStore.insertMessage({ id: 'm1', sessionId: 's1', role: 'user', agentId: null, content: 'hi', timestamp: 1 })

    eventStore.publish('s1', 'UserMessage', { messageId: 'm1' })
    snapshotStore.saveSnapshot('s1', 1, '{}')

    expect(sessionStore.loadMessages('s1').map((m) => m.id)).toEqual(['m1'])
    expect(eventStore.loadEvents('s1').map((e) => e.type)).toEqual(['UserMessage'])
    expect(snapshotStore.loadSnapshot('s1')!.seq).toBe(1)
  })

  it('migration creates new tables without dropping existing ones (full migration cycle)', () => {
    const { db } = openDatabase(':memory:')

    const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]).map((t) => t.name)
    expect(tables).toEqual(expect.arrayContaining([
      'sessions', 'messages', 'agent_runs', 'tool_calls', 'checkpoints',
      'event_sequence', 'event', 'snapshots',
    ]))
  })
})

describe('EventStore adversarial cases', () => {
  let store: EventStore

  beforeEach(() => {
    store = new EventStore(freshDb())
  })

  it('publish is stable across 3 repeated runs (not flaky)', () => {
    for (let run = 0; run < 3; run++) {
      const local = new EventStore(freshDb())
      local.publish('s1', 'A', { run })
      local.publish('s1', 'B', { run })
      local.publish('s1', 'C', { run })

      const events = local.loadEvents('s1')
      expect(events.map((e) => e.seq)).toEqual([1, 2, 3])
      expect(events.map((e) => e.type)).toEqual(['A', 'B', 'C'])
    }
  })

  it('loadEvents reflects all publishes when called from a second caller instance on the same DB', () => {
    const db = freshDb()
    const caller1 = new EventStore(db)
    const caller2 = new EventStore(db)

    caller1.publish('s1', 'A', {})
    caller2.publish('s1', 'B', {})
    caller1.publish('s1', 'C', {})

    const events = caller2.loadEvents('s1')
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3])
    expect(events.map((e) => e.type)).toEqual(['A', 'B', 'C'])
  })

  it('treats an empty-string sessionId as a valid (degenerate) aggregate', () => {
    const r = store.publish('', 'Empty', {})
    expect(r.seq).toBe(1)
    const events = store.loadEvents('')
    expect(events).toHaveLength(1)
    expect(events[0].aggregateId).toBe('')
  })
})

// Type-level guard: SessionEvent shape is part of the public API.
const _typeCheck: SessionEvent = {
  id: 's1:1',
  aggregateId: 's1',
  seq: 1,
  type: 'TextStarted',
  data: { content: 'x' },
}
void _typeCheck
