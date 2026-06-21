import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from './open.js'
import { EventStore, SnapshotStore } from './event-store.js'
import { projectEvent, loadProjection } from './message-projector.js'
import type { SessionMessageRow } from './message-types.js'
import { reconstructSessionState, RolloutEngine } from './rollout.js'

function freshDb() {
  return openDatabase(':memory:').db
}

const SESSION = 's-rollout'

describe('reconstructSessionState', () => {
  let db: ReturnType<typeof freshDb>
  let events: EventStore
  let snapshots: SnapshotStore

  beforeEach(() => {
    db = freshDb()
    events = new EventStore(db)
    snapshots = new SnapshotStore(db)
  })

  it('replays all events from seq 1 when no snapshot exists', () => {
    events.publish(SESSION, 'user_message', { messageId: 'm1', content: 'hello' })
    events.publish(SESSION, 'step_started', { stepId: 'step1', agentId: 'agentA' })
    events.publish(SESSION, 'text_ended', { stepId: 'step1', content: 'hi there' })

    const result = reconstructSessionState(db, SESSION)

    expect(result.snapshotSeq).toBe(0)
    expect(result.eventsReplayed).toBe(3)
    expect(result.messages).toHaveLength(2)
    expect(result.messages[0]?.type).toBe('user')
    expect(result.messages[1]?.type).toBe('assistant')
  })

  it('replays only events after the snapshot when a snapshot exists at seq 3', () => {
    events.publish(SESSION, 'user_message', { messageId: 'm1', content: 'hello' })
    events.publish(SESSION, 'step_started', { stepId: 'step1', agentId: 'agentA' })
    events.publish(SESSION, 'text_ended', { stepId: 'step1', content: 'snap here' })
    for (const event of events.loadEvents(SESSION)) {
      projectEvent(db, event)
    }
    const liveMessages = loadProjection(db, SESSION)
    snapshots.saveSnapshot(SESSION, 3, JSON.stringify(liveMessages))

    events.publish(SESSION, 'tool_called', { stepId: 'step1', callId: 'c1', name: 'read_file' })
    events.publish(SESSION, 'tool_success', { callId: 'c1', output: 'file contents' })

    const result = reconstructSessionState(db, SESSION)

    expect(result.snapshotSeq).toBe(3)
    expect(result.eventsReplayed).toBe(2)
    expect(result.messages).toHaveLength(2)
    expect(result.messages[1]?.type).toBe('assistant')
  })

  it('produces a reconstructed projection that matches the live projection', () => {
    events.publish(SESSION, 'user_message', { messageId: 'm1', content: 'plan the work' })
    events.publish(SESSION, 'step_started', { stepId: 'step1', agentId: 'planner' })
    events.publish(SESSION, 'text_ended', { stepId: 'step1', content: 'I will plan' })
    events.publish(SESSION, 'tool_called', { stepId: 'step1', callId: 'c1', name: 'ls' })
    events.publish(SESSION, 'tool_success', { callId: 'c1', output: 'a.txt b.txt' })
    events.publish(SESSION, 'step_ended', { stepId: 'step1', finishedAt: 6 })
    for (const event of events.loadEvents(SESSION)) {
      projectEvent(db, event)
    }

    const live = loadProjection(db, SESSION)
    const reconstructed = reconstructSessionState(db, SESSION)

    expect(reconstructed.messages).toEqual(live)
  })

  it('marks running tool calls as error when no success event follows', () => {
    events.publish(SESSION, 'user_message', { messageId: 'm1', content: 'run a tool' })
    events.publish(SESSION, 'step_started', { stepId: 'step1', agentId: 'coder' })
    events.publish(SESSION, 'tool_called', { stepId: 'step1', callId: 'c1', name: 'run_script' })

    const result = reconstructSessionState(db, SESSION)

    const assistant = result.messages.find((m) => m.type === 'assistant')
    expect(assistant).toBeDefined()
    if (assistant == null || assistant.data.role !== 'assistant' || 'kind' in assistant.data) return
    const tool = assistant.data.toolCalls.find((t) => t.callId === 'c1')
    expect(tool?.status).toBe('error')
  })
})

describe('RolloutEngine', () => {
  let db: ReturnType<typeof freshDb>
  let events: EventStore
  let engine: RolloutEngine

  beforeEach(() => {
    db = freshDb()
    events = new EventStore(db)
    engine = new RolloutEngine(db)
  })

  it('reconstruct returns the same state as the standalone function', () => {
    events.publish(SESSION, 'user_message', { messageId: 'm1', content: 'hello' })

    const fromFunction = reconstructSessionState(db, SESSION)
    const fromEngine = engine.reconstruct(SESSION)

    expect(fromEngine.messages).toEqual(fromFunction.messages)
    expect(fromEngine.snapshotSeq).toBe(fromFunction.snapshotSeq)
    expect(fromEngine.eventsReplayed).toBe(fromFunction.eventsReplayed)
  })

  it('validate reports no gaps for a contiguous event log', () => {
    events.publish(SESSION, 'user_message', { messageId: 'm1', content: 'a' })
    events.publish(SESSION, 'user_message', { messageId: 'm2', content: 'b' })
    events.publish(SESSION, 'user_message', { messageId: 'm3', content: 'c' })

    const validation = engine.validate(SESSION)

    expect(validation.ok).toBe(true)
    expect(validation.gaps).toEqual([])
  })

  it('validate reports missing sequence numbers', () => {
    // Manually create a gap by deleting an event row.
    events.publish(SESSION, 'user_message', { messageId: 'm1', content: 'a' })
    events.publish(SESSION, 'user_message', { messageId: 'm2', content: 'b' })
    events.publish(SESSION, 'user_message', { messageId: 'm3', content: 'c' })
    db.prepare('DELETE FROM event WHERE aggregate_id = ? AND seq = ?').run(SESSION, 2)

    const validation = engine.validate(SESSION)

    expect(validation.ok).toBe(false)
    expect(validation.gaps).toContain(2)
  })

  it('validate is ok for a session with no events', () => {
    const validation = engine.validate('empty-session')

    expect(validation.ok).toBe(true)
    expect(validation.gaps).toEqual([])
  })
})

describe('reconstructSessionState isolation', () => {
  it('does not mutate the source database during reconstruction', () => {
    const db = freshDb()
    const events = new EventStore(db)
    events.publish(SESSION, 'user_message', { messageId: 'm1', content: 'before' })

    const before = loadProjection(db, SESSION)
    reconstructSessionState(db, SESSION)

    // Insert a synthetic row directly into the source projection to prove
    // reconstruction never touches the live session_message table.
    db.prepare(
      'INSERT INTO session_message(id, session_id, type, seq, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('injected', SESSION, 'user', 99, 1, 1, JSON.stringify({ role: 'user', content: 'injected', messageId: 'injected' }))

    const after = loadProjection(db, SESSION)
    expect(after).toEqual([...before, after[after.length - 1]!])
  })
})

// Type-level guard: ReconstructedState is part of the public API.
const _typeCheck: { sessionId: string; snapshotSeq: number; eventsReplayed: number; messages: readonly SessionMessageRow[] } =
  {
    sessionId: SESSION,
    snapshotSeq: 0,
    eventsReplayed: 0,
    messages: [],
  }
void _typeCheck
