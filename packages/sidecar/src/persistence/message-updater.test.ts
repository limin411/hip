import { describe, it, expect, beforeEach, vi } from 'vitest'
import { openDatabase } from './open.js'
import type { DatabaseSync } from './sqlite.js'
import type { SessionEvent } from './event-store.js'
import { SessionMessageUpdater } from './message-updater.js'
import { loadProjection } from './message-projector.js'
import type { AssistantStepData } from './message-types.js'

let seqCounter = 0

function freshDb(): DatabaseSync {
  return openDatabase(':memory:').db
}

function ev(
  sessionId: string,
  type: SessionEvent['type'],
  data: Record<string, unknown>,
): SessionEvent {
  seqCounter += 1
  return {
    id: `${sessionId}:${seqCounter}`,
    aggregateId: sessionId,
    seq: seqCounter,
    type,
    data,
  }
}

function stepData(db: DatabaseSync, sessionId: string): AssistantStepData {
  const row = loadProjection(db, sessionId)[0]
  if (row == null) throw new Error('no rows')
  if (row.data.role !== 'assistant' || 'kind' in row.data) {
    throw new Error('row is not an assistant step')
  }
  return row.data
}

beforeEach(() => {
  seqCounter = 0
})

const SID = 'sess-1'

describe('SessionMessageUpdater: user_message', () => {
  it('INSERTs a user row using messageId as the row id', () => {
    const db = freshDb()
    const updater = new SessionMessageUpdater(db)

    updater.apply(ev(SID, 'user_message', { messageId: 'm1', content: 'hello', timestamp: 1000 }))

    const rows = loadProjection(db, SID)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'm1',
      sessionId: SID,
      type: 'user',
      seq: 1,
      timeCreated: 1000,
      timeUpdated: 1000,
      data: { role: 'user', content: 'hello', messageId: 'm1' },
    })
  })

  it('falls back to event.seq when timestamp is missing', () => {
    const db = freshDb()
    const updater = new SessionMessageUpdater(db)

    updater.apply(ev(SID, 'user_message', { messageId: 'm1', content: 'hi' }))

    const row = loadProjection(db, SID)[0]
    expect(row?.timeCreated).toBe(1)
    expect(row?.timeUpdated).toBe(1)
  })

  it('throws when required fields are missing', () => {
    const db = freshDb()
    const updater = new SessionMessageUpdater(db)

    expect(() => updater.apply(ev(SID, 'user_message', { content: 'hi' }))).toThrow(/messageId/)
    expect(() => updater.apply(ev(SID, 'user_message', { messageId: 'm1' }))).toThrow(/content/)
  })
})

describe('SessionMessageUpdater: step lifecycle', () => {
  it('INSERTs an assistant step with defaults', () => {
    const db = freshDb()
    const updater = new SessionMessageUpdater(db)

    updater.apply(ev(SID, 'step_started', { stepId: 's1', agentId: 'a1' }))

    const rows = loadProjection(db, SID)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.type).toBe('assistant')
    expect(rows[0]?.id).toBe(`${SID}:step:s1`)
    const data = rows[0]?.data as AssistantStepData
    expect(data.agentRole).toBe('assistant')
    expect(data.content).toBe('')
    expect(data.toolCalls).toEqual([])
    expect(data.finishedAt).toBeNull()
    expect(data.error).toBeNull()
    expect(data.usage).toBeNull()
  })

  it('UPDATEs step with content via text_ended', () => {
    const db = freshDb()
    const updater = new SessionMessageUpdater(db)

    updater.apply(ev(SID, 'step_started', { stepId: 's1', agentId: 'a1' }))
    updater.apply(ev(SID, 'text_ended', { stepId: 's1', content: 'Hello' }))

    const data = loadProjection(db, SID)[0]?.data as AssistantStepData
    expect(data.content).toBe('Hello')
  })

  it('appends content on multiple text_ended events', () => {
    const db = freshDb()
    const updater = new SessionMessageUpdater(db)

    updater.apply(ev(SID, 'step_started', { stepId: 's1', agentId: 'a1' }))
    updater.apply(ev(SID, 'text_ended', { stepId: 's1', content: 'A' }))
    updater.apply(ev(SID, 'text_ended', { stepId: 's1', content: 'B' }))

    const data = loadProjection(db, SID)[0]?.data as AssistantStepData
    expect(data.content).toBe('AB')
  })

  it('warns and no-ops when patching a missing step', () => {
    const db = freshDb()
    const updater = new SessionMessageUpdater(db)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    updater.apply(ev(SID, 'text_ended', { stepId: 'missing', content: 'x' }))

    expect(loadProjection(db, SID)).toHaveLength(0)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

describe('SessionMessageUpdater: tool calls', () => {
  it('adds a running tool call and settles it to finished', () => {
    const db = freshDb()
    const updater = new SessionMessageUpdater(db)

    updater.apply(ev(SID, 'step_started', { stepId: 's1', agentId: 'a1' }))
    updater.apply(ev(SID, 'tool_called', { stepId: 's1', callId: 'c1', name: 'read_file', input: '{}', seq: 1 }))
    updater.apply(ev(SID, 'tool_success', { callId: 'c1', stepId: 's1', output: 'ok' }))

    const data = loadProjection(db, SID)[0]?.data as AssistantStepData
    expect(data.toolCalls).toHaveLength(1)
    expect(data.toolCalls[0]).toMatchObject({
      callId: 'c1',
      name: 'read_file',
      status: 'finished',
      output: 'ok',
    })
  })

  it('settles a tool call to error', () => {
    const db = freshDb()
    const updater = new SessionMessageUpdater(db)

    updater.apply(ev(SID, 'step_started', { stepId: 's1', agentId: 'a1' }))
    updater.apply(ev(SID, 'tool_called', { stepId: 's1', callId: 'c1', name: 'bash', input: '{}', seq: 1 }))
    updater.apply(ev(SID, 'tool_failed', { callId: 'c1', stepId: 's1', error: 'boom' }))

    const data = loadProjection(db, SID)[0]?.data as AssistantStepData
    expect(data.toolCalls[0]?.status).toBe('error')
    expect(data.toolCalls[0]?.error).toBe('boom')
  })

  it('falls back to session-wide scan when stepId hint is absent on tool settlement', () => {
    const db = freshDb()
    const updater = new SessionMessageUpdater(db)

    updater.apply(ev(SID, 'step_started', { stepId: 's1', agentId: 'a1' }))
    updater.apply(ev(SID, 'tool_called', { stepId: 's1', callId: 'c1', name: 'ls', input: '{}', seq: 1 }))
    updater.apply(ev(SID, 'tool_success', { callId: 'c1', output: 'dir' }))

    const data = loadProjection(db, SID)[0]?.data as AssistantStepData
    expect(data.toolCalls[0]?.status).toBe('finished')
    expect(data.toolCalls[0]?.output).toBe('dir')
  })

  it('keeps multiple tool calls sorted by seq', () => {
    const db = freshDb()
    const updater = new SessionMessageUpdater(db)

    updater.apply(ev(SID, 'step_started', { stepId: 's1', agentId: 'a1' }))
    updater.apply(ev(SID, 'tool_called', { stepId: 's1', callId: 'c2', name: 'b', input: '{}', seq: 2 }))
    updater.apply(ev(SID, 'tool_called', { stepId: 's1', callId: 'c1', name: 'a', input: '{}', seq: 1 }))

    const data = loadProjection(db, SID)[0]?.data as AssistantStepData
    expect(data.toolCalls.map((t) => t.callId)).toEqual(['c1', 'c2'])
  })

  it('warns when tool settlement cannot find the call', () => {
    const db = freshDb()
    const updater = new SessionMessageUpdater(db)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    updater.apply(ev(SID, 'tool_success', { callId: 'missing', stepId: 's1', output: 'x' }))

    expect(loadProjection(db, SID)).toHaveLength(0)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

describe('SessionMessageUpdater: step_ended + step_failed', () => {
  it('sets finishedAt and usage on step_ended', () => {
    const db = freshDb()
    const updater = new SessionMessageUpdater(db)

    updater.apply(ev(SID, 'step_started', { stepId: 's1', agentId: 'a1' }))
    updater.apply(
      ev(SID, 'step_ended', {
        stepId: 's1',
        finishedAt: 200,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      }),
    )

    const data = loadProjection(db, SID)[0]?.data as AssistantStepData
    expect(data.finishedAt).toBe(200)
    expect(data.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })
  })

  it('sets error and finishedAt on step_failed', () => {
    const db = freshDb()
    const updater = new SessionMessageUpdater(db)

    updater.apply(ev(SID, 'step_started', { stepId: 's1', agentId: 'a1' }))
    updater.apply(ev(SID, 'step_failed', { stepId: 's1', error: 'crashed', finishedAt: 200 }))

    const data = loadProjection(db, SID)[0]?.data as AssistantStepData
    expect(data.error).toBe('crashed')
    expect(data.finishedAt).toBe(200)
  })
})

describe('SessionMessageUpdater: compaction_ended', () => {
  it('INSERTs a compaction row with replaced message ids', () => {
    const db = freshDb()
    const updater = new SessionMessageUpdater(db)

    updater.apply(ev(SID, 'compaction_ended', { summary: 'compacted', replacedMessageIds: ['m1', 'm2'], timestamp: 999 }))

    const rows = loadProjection(db, SID)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.type).toBe('compaction')
    expect(rows[0]?.id).toBe(`${SID}:compaction:1`)
    expect(rows[0]?.data).toEqual({
      role: 'assistant',
      kind: 'compaction',
      summary: 'compacted',
      replacedMessageIds: ['m1', 'm2'],
    })
  })
})

describe('SessionMessageUpdater: no-op event types', () => {
  it('text_started does not create a row', () => {
    const db = freshDb()
    const updater = new SessionMessageUpdater(db)

    updater.apply(ev(SID, 'text_started', { stepId: 's1' }))

    expect(loadProjection(db, SID)).toHaveLength(0)
  })

  it('agent_switched and model_switched do not create rows', () => {
    const db = freshDb()
    const updater = new SessionMessageUpdater(db)

    updater.apply(ev(SID, 'agent_switched', { from: 'a', to: 'b' }))
    updater.apply(ev(SID, 'model_switched', { from: 'm1', to: 'm2' }))

    expect(loadProjection(db, SID)).toHaveLength(0)
  })
})

describe('SessionMessageUpdater: replay idempotency', () => {
  it('produces identical state when the same events are applied twice', () => {
    const db = freshDb()
    const updater = new SessionMessageUpdater(db)
    const events = [
      ev(SID, 'user_message', { messageId: 'u1', content: 'hi', timestamp: 1 }),
      ev(SID, 'step_started', { stepId: 'a1', agentId: 'a1' }),
      ev(SID, 'text_ended', { stepId: 'a1', content: 'reply' }),
    ]

    events.forEach((e) => updater.apply(e))
    const first = loadProjection(db, SID)

    events.forEach((e) => updater.apply(e))
    const second = loadProjection(db, SID)

    expect(second).toEqual(first)
  })
})
