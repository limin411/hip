import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'
import { EventStore, type SessionEvent } from '../persistence/event-store.js'
import { projectEvent, projectEvents, loadProjection } from '../persistence/message-projector.js'
import type { SessionConfig } from '@hip/protocol'

const baseCfg: SessionConfig = {
  llmProvider: 'openai',
  model: 'gpt-4',
  tools: [],
  useEventSource: true,
}

function insertSession(store: SessionStore, sessionId: string): void {
  store.insertSession({
    id: sessionId,
    title: 'event-sourcing-test',
    config: JSON.stringify(baseCfg),
    createdAt: 1,
    updatedAt: 1,
  })
}

function publishEvent(
  db: ReturnType<typeof openDatabase>['db'],
  eventStore: EventStore,
  sessionId: string,
  type: string,
  data: Record<string, unknown>,
): SessionEvent {
  db.exec('BEGIN')
  const event = eventStore.append(sessionId, type, data)
  projectEvent(db, event)
  db.exec('COMMIT')
  return event
}

describe('Event sourcing replay', () => {
  let db: ReturnType<typeof openDatabase>['db']
  let store: SessionStore
  let eventStore: EventStore

  beforeEach(() => {
    const opened = openDatabase(':memory:')
    db = opened.db
    store = new SessionStore(db, opened.ftsEnabled)
    eventStore = new EventStore(db)
  })

  it('replays events into an identical projection', () => {
    const sessionId = 's-replay-1'
    insertSession(store, sessionId)

    publishEvent(db, eventStore, sessionId, 'user_message', {
      messageId: 'u-1',
      content: 'List files',
      timestamp: 1,
    })

    publishEvent(db, eventStore, sessionId, 'step_started', {
      stepId: 'a-1',
      agentId: 'supervisor',
      startedAt: 2,
    })

    publishEvent(db, eventStore, sessionId, 'text_ended', {
      stepId: 'a-1',
      content: 'I will list the files for you.',
      timestamp: 3,
    })

    publishEvent(db, eventStore, sessionId, 'tool_called', {
      stepId: 'a-1',
      callId: 'c-1',
      name: 'ls',
      input: '{"path":"/"}',
      seq: 4,
    })

    publishEvent(db, eventStore, sessionId, 'tool_success', {
      stepId: 'a-1',
      callId: 'c-1',
      output: 'bin etc home',
      timestamp: 5,
    })

    publishEvent(db, eventStore, sessionId, 'text_ended', {
      stepId: 'a-1',
      content: 'Done.',
      timestamp: 6,
    })

    publishEvent(db, eventStore, sessionId, 'step_ended', {
      stepId: 'a-1',
      finishedAt: 7,
    })

    publishEvent(db, eventStore, sessionId, 'user_message', {
      messageId: 'u-2',
      content: 'Thanks',
      timestamp: 8,
    })

    const liveRows = loadProjection(db, sessionId)
    const events = eventStore.loadEvents(sessionId)

    const replayed = openDatabase(':memory:')
    const replayStore = new SessionStore(replayed.db, replayed.ftsEnabled)
    insertSession(replayStore, sessionId)
    projectEvents(replayed.db, events)
    const replayedRows = loadProjection(replayed.db, sessionId)

    expect(replayedRows).toHaveLength(liveRows.length)
    expect(replayedRows.map((r) => r.id)).toEqual(liveRows.map((r) => r.id))
    expect(replayedRows.map((r) => r.type)).toEqual(liveRows.map((r) => r.type))
    expect(replayedRows.map((r) => r.seq)).toEqual(liveRows.map((r) => r.seq))
    expect(replayedRows.map((r) => JSON.stringify(r.data))).toEqual(
      liveRows.map((r) => JSON.stringify(r.data)),
    )
  })

  it('replays out-of-order tool events deterministically', () => {
    const sessionId = 's-replay-2'
    insertSession(store, sessionId)

    publishEvent(db, eventStore, sessionId, 'step_started', {
      stepId: 'a-1',
      agentId: 'supervisor',
      startedAt: 1,
    })

    publishEvent(db, eventStore, sessionId, 'tool_called', {
      stepId: 'a-1',
      callId: 'c-2',
      name: 'glob',
      input: '{"pattern":"**/*.ts"}',
      seq: 3,
    })

    publishEvent(db, eventStore, sessionId, 'tool_called', {
      stepId: 'a-1',
      callId: 'c-1',
      name: 'ls',
      input: '{"path":"/"}',
      seq: 2,
    })

    publishEvent(db, eventStore, sessionId, 'tool_success', {
      stepId: 'a-1',
      callId: 'c-1',
      output: 'a b',
      timestamp: 4,
    })

    publishEvent(db, eventStore, sessionId, 'tool_success', {
      stepId: 'a-1',
      callId: 'c-2',
      output: 'x.ts y.ts',
      timestamp: 5,
    })

    const liveRows = loadProjection(db, sessionId)
    const events = eventStore.loadEvents(sessionId)

    const replayed = openDatabase(':memory:')
    const replayStore = new SessionStore(replayed.db, replayed.ftsEnabled)
    insertSession(replayStore, sessionId)
    projectEvents(replayed.db, events)
    const replayedRows = loadProjection(replayed.db, sessionId)

    expect(replayedRows).toHaveLength(liveRows.length)
    const liveStep = liveRows.find((r) => r.type === 'assistant')
    const replayedStep = replayedRows.find((r) => r.type === 'assistant')
    expect(replayedStep).toBeDefined()
    expect(replayedStep!.data).toEqual(liveStep!.data)
  })

  it('skips unknown event types during replay', () => {
    const sessionId = 's-replay-3'
    insertSession(store, sessionId)

    publishEvent(db, eventStore, sessionId, 'user_message', {
      messageId: 'u-1',
      content: 'Hello',
      timestamp: 1,
    })

    publishEvent(db, eventStore, sessionId, 'future_event_v2', {
      payload: 'ignored',
    })

    const liveRows = loadProjection(db, sessionId)
    const events = eventStore.loadEvents(sessionId)

    const replayed = openDatabase(':memory:')
    const replayStore = new SessionStore(replayed.db, replayed.ftsEnabled)
    insertSession(replayStore, sessionId)
    projectEvents(replayed.db, events)
    const replayedRows = loadProjection(replayed.db, sessionId)

    expect(replayedRows).toEqual(liveRows)
  })
})
