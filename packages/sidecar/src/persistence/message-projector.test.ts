import { describe, it, expect, beforeEach, vi } from 'vitest'
import { openDatabase } from './open.js'
import type { DatabaseSync } from './sqlite.js'
import type { SessionEvent } from './event-store.js'
import {
  projectEvent,
  projectEvents,
  loadProjection,
  SessionMessageUpdater,
  stepRowId,
  compactionRowId,
  type AssistantStepData,
} from './message-projector.js'

// ── fixtures ─────────────────────────────────────────────────────────────────

function freshDb(): DatabaseSync {
  return openDatabase(':memory:').db
}

let seqCounter = 0
/** Build a SessionEvent with auto-incrementing seq, mimicking EventStore.publish output. */
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

const SID = 'sess-1'

beforeEach(() => {
  seqCounter = 0
})

// ── tests ────────────────────────────────────────────────────────────────────

describe('projectEvent: user_message', () => {
  it('INSERTs a new user row with role=user and the provided content', () => {
    const db = freshDb()
    const event = ev(SID, 'user_message', {
      messageId: 'm1',
      content: 'hello world',
      timestamp: 1_700_000_000_000,
    })

    projectEvent(db, event)

    const rows = loadProjection(db, SID)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'm1',
      sessionId: SID,
      type: 'user',
      seq: event.seq,
      timeCreated: 1_700_000_000_000,
      timeUpdated: 1_700_000_000_000,
    })
    expect(rows[0].data).toEqual({
      role: 'user',
      content: 'hello world',
      messageId: 'm1',
    })
  })

  it('falls back to event.seq for time_created when timestamp is absent', () => {
    const db = freshDb()
    const event = ev(SID, 'user_message', { messageId: 'm1', content: 'hi' })

    projectEvent(db, event)

    const rows = loadProjection(db, SID)
    expect(rows[0]?.timeCreated).toBe(event.seq)
    expect(rows[0]?.timeUpdated).toBe(event.seq)
  })

  it('is idempotent under replay (projecting the same event twice yields one row)', () => {
    const db = freshDb()
    const event = ev(SID, 'user_message', { messageId: 'm1', content: 'hi', timestamp: 100 })

    projectEvent(db, event)
    projectEvent(db, event)

    expect(loadProjection(db, SID)).toHaveLength(1)
  })
})

describe('projectEvent: step_started', () => {
  it('INSERTs a new assistant row with empty pending content', () => {
    const db = freshDb()
    const event = ev(SID, 'step_started', {
      stepId: 'step-1',
      agentId: 'supervisor',
      agentRole: 'supervisor',
      startedAt: 1_700_000_000_000,
    })

    projectEvent(db, event)

    const rows = loadProjection(db, SID)
    expect(rows).toHaveLength(1)
    const data = rows[0]?.data as AssistantStepData
    expect(rows[0]?.type).toBe('assistant')
    expect(data).toMatchObject({
      role: 'assistant',
      stepId: 'step-1',
      agentId: 'supervisor',
      agentRole: 'supervisor',
      content: '',
      toolCalls: [],
      startedAt: 1_700_000_000_000,
      finishedAt: null,
      error: null,
      usage: null,
    })
    expect(rows[0]?.id).toBe(stepRowId(SID, 'step-1'))
  })

  it('defaults agentRole to "assistant" when absent', () => {
    const db = freshDb()
    projectEvent(db, ev(SID, 'step_started', { stepId: 's', agentId: 'a1' }))

    const data = loadProjection(db, SID)[0]?.data as AssistantStepData
    expect(data.agentRole).toBe('assistant')
  })
})

describe('projectEvent: text_ended', () => {
  it('UPDATEs the assistant message content', () => {
    const db = freshDb()
    projectEvent(db, ev(SID, 'step_started', { stepId: 'step-1', agentId: 'a1', startedAt: 100 }))
    projectEvent(db, ev(SID, 'text_ended', { stepId: 'step-1', content: 'final text' }))

    const data = loadProjection(db, SID)[0]?.data as AssistantStepData
    expect(data.content).toBe('final text')
  })

  it('appends when text_ended fires twice on the same step', () => {
    const db = freshDb()
    projectEvent(db, ev(SID, 'step_started', { stepId: 's', agentId: 'a', startedAt: 1 }))
    projectEvent(db, ev(SID, 'text_ended', { stepId: 's', content: 'Hello' }))
    projectEvent(db, ev(SID, 'text_ended', { stepId: 's', content: ', world.' }))

    const data = loadProjection(db, SID)[0]?.data as AssistantStepData
    expect(data.content).toBe('Hello, world.')
  })

  it('warns and no-ops when the target step does not exist', () => {
    const db = freshDb()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    projectEvent(db, ev(SID, 'text_ended', { stepId: 'missing', content: 'x' }))

    expect(loadProjection(db, SID)).toHaveLength(0)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

describe('projectEvent: tool_called + tool_success', () => {
  it('adds a running tool call, then transitions to finished on tool_success', () => {
    const db = freshDb()
    projectEvent(db, ev(SID, 'step_started', { stepId: 's', agentId: 'a', startedAt: 1 }))
    projectEvent(
      db,
      ev(SID, 'tool_called', {
        stepId: 's',
        callId: 'c1',
        name: 'read_file',
        input: '{"path":"/x"}',
        seq: 1,
      }),
    )

    const afterCalled = loadProjection(db, SID)[0]?.data as AssistantStepData
    expect(afterCalled.toolCalls).toHaveLength(1)
    expect(afterCalled.toolCalls[0]).toMatchObject({
      callId: 'c1',
      name: 'read_file',
      input: '{"path":"/x"}',
      status: 'running',
      output: null,
      error: null,
      seq: 1,
    })

    projectEvent(
      db,
      ev(SID, 'tool_success', { callId: 'c1', stepId: 's', output: 'file body' }),
    )

    const afterSettled = loadProjection(db, SID)[0]?.data as AssistantStepData
    expect(afterSettled.toolCalls[0]?.status).toBe('finished')
    expect(afterSettled.toolCalls[0]?.output).toBe('file body')
  })

  it('transitions to error on tool_failed', () => {
    const db = freshDb()
    projectEvent(db, ev(SID, 'step_started', { stepId: 's', agentId: 'a', startedAt: 1 }))
    projectEvent(db, ev(SID, 'tool_called', { stepId: 's', callId: 'c1', name: 'bash', input: '{}', seq: 1 }))
    projectEvent(db, ev(SID, 'tool_failed', { callId: 'c1', stepId: 's', error: 'exit 1' }))

    const data = loadProjection(db, SID)[0]?.data as AssistantStepData
    expect(data.toolCalls[0]?.status).toBe('error')
    expect(data.toolCalls[0]?.error).toBe('exit 1')
  })

  it('tool_success without stepId hint falls back to a session-wide scan', () => {
    const db = freshDb()
    projectEvent(db, ev(SID, 'step_started', { stepId: 's', agentId: 'a', startedAt: 1 }))
    projectEvent(db, ev(SID, 'tool_called', { stepId: 's', callId: 'c1', name: 'ls', input: '{}', seq: 1 }))
    projectEvent(db, ev(SID, 'tool_success', { callId: 'c1', output: 'dir' }))

    const data = loadProjection(db, SID)[0]?.data as AssistantStepData
    expect(data.toolCalls[0]?.status).toBe('finished')
    expect(data.toolCalls[0]?.output).toBe('dir')
  })

  it('multiple tool calls on the same step are kept in seq order', () => {
    const db = freshDb()
    projectEvent(db, ev(SID, 'step_started', { stepId: 's', agentId: 'a', startedAt: 1 }))
    projectEvent(db, ev(SID, 'tool_called', { stepId: 's', callId: 'c2', name: 'b', input: '{}', seq: 2 }))
    projectEvent(db, ev(SID, 'tool_called', { stepId: 's', callId: 'c1', name: 'a', input: '{}', seq: 1 }))

    const data = loadProjection(db, SID)[0]?.data as AssistantStepData
    expect(data.toolCalls.map((t) => t.callId)).toEqual(['c1', 'c2'])
  })
})

describe('projectEvent: step_ended + step_failed', () => {
  it('step_ended sets finishedAt + usage', () => {
    const db = freshDb()
    projectEvent(db, ev(SID, 'step_started', { stepId: 's', agentId: 'a', startedAt: 100 }))
    projectEvent(
      db,
      ev(SID, 'step_ended', {
        stepId: 's',
        finishedAt: 200,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      }),
    )

    const data = loadProjection(db, SID)[0]?.data as AssistantStepData
    expect(data.finishedAt).toBe(200)
    expect(data.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })
  })

  it('step_failed sets error + finishedAt', () => {
    const db = freshDb()
    projectEvent(db, ev(SID, 'step_started', { stepId: 's', agentId: 'a', startedAt: 100 }))
    projectEvent(db, ev(SID, 'step_failed', { stepId: 's', error: 'crashed', finishedAt: 200 }))

    const data = loadProjection(db, SID)[0]?.data as AssistantStepData
    expect(data.error).toBe('crashed')
    expect(data.finishedAt).toBe(200)
  })
})

describe('projectEvent: compaction_ended', () => {
  it('INSERTs a compaction message row with summary + replaced ids', () => {
    const db = freshDb()
    const event = ev(SID, 'compaction_ended', {
      summary: 'prior conversation was about X',
      replacedMessageIds: ['m1', 'm2'],
      timestamp: 999,
    })

    projectEvent(db, event)

    const rows = loadProjection(db, SID)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.type).toBe('compaction')
    expect(rows[0]?.id).toBe(compactionRowId(SID, event.seq))
    expect(rows[0]?.data).toEqual({
      role: 'assistant',
      kind: 'compaction',
      summary: 'prior conversation was about X',
      replacedMessageIds: ['m1', 'm2'],
    })
  })
})

describe('projectEvent: no-op event types', () => {
  it('text_started is a no-op (assistant row already exists from step_started)', () => {
    const db = freshDb()
    projectEvent(db, ev(SID, 'text_started', { stepId: 's' }))
    expect(loadProjection(db, SID)).toHaveLength(0)
  })

  it('agent_switched is a no-op', () => {
    const db = freshDb()
    projectEvent(db, ev(SID, 'agent_switched', { from: 'supervisor', to: 'plan' }))
    expect(loadProjection(db, SID)).toHaveLength(0)
  })

  it('model_switched is a no-op', () => {
    const db = freshDb()
    projectEvent(db, ev(SID, 'model_switched', { from: 'm1', to: 'm2' }))
    expect(loadProjection(db, SID)).toHaveLength(0)
  })
})

describe('projectEvent: unknown event type', () => {
  it('warns and no-ops on an event type outside SESSION_EVENT_TYPES', () => {
    const db = freshDb()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    projectEvent(db, ev(SID, 'some_future_event', { foo: 'bar' }))

    expect(loadProjection(db, SID)).toHaveLength(0)
    expect(warn).toHaveBeenCalledTimes(1)
    const msg = warn.mock.calls[0]?.[0] as string
    expect(msg).toContain('some_future_event')
    warn.mockRestore()
  })
})

describe('projectEvents: 10-event replay', () => {
  it('replays a mixed stream and converges to the expected projection state', () => {
    const db = freshDb()
    // Build a realistic 10-event stream:
    //   1. user_message
    //   2. step_started (assistant step-1)
    //   3. text_started (no-op)
    //   4. text_ended (partial content)
    //   5. tool_called (read_file)
    //   6. tool_success
    //   7. text_ended (final summary content)
    //   8. step_ended
    //   9. user_message (second turn)
    //  10. step_started (assistant step-2)
    const events: SessionEvent[] = [
      ev(SID, 'user_message', { messageId: 'u1', content: 'read /etc/hosts', timestamp: 1 }),
      ev(SID, 'step_started', { stepId: 'a1', agentId: 'sup', agentRole: 'supervisor', startedAt: 2 }),
      ev(SID, 'text_started', { stepId: 'a1' }),
      ev(SID, 'text_ended', { stepId: 'a1', content: 'Reading file...' }),
      ev(SID, 'tool_called', { stepId: 'a1', callId: 't1', name: 'read_file', input: '{"path":"/etc/hosts"}', seq: 1 }),
      ev(SID, 'tool_success', { callId: 't1', stepId: 'a1', output: '127.0.0.1 localhost' }),
      ev(SID, 'text_ended', { stepId: 'a1', content: ' Done.' }),
      ev(SID, 'step_ended', { stepId: 'a1', finishedAt: 9, usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 } }),
      ev(SID, 'user_message', { messageId: 'u2', content: 'thanks', timestamp: 10 }),
      ev(SID, 'step_started', { stepId: 'a2', agentId: 'sup', agentRole: 'supervisor', startedAt: 11 }),
    ]

    projectEvents(db, events)

    const rows = loadProjection(db, SID)
    // 2 user rows + 2 assistant rows = 4 (text_started / tool_* / step_ended mutate, not insert)
    expect(rows).toHaveLength(4)

    expect(rows.map((r) => r.type)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 9, 10])

    // first user row
    expect(rows[0]?.data).toMatchObject({ role: 'user', content: 'read /etc/hosts', messageId: 'u1' })

    // first assistant row — content accumulated across two text_ended events; one finished tool
    const a1 = rows[1]?.data as AssistantStepData
    expect(a1.content).toBe('Reading file... Done.')
    expect(a1.toolCalls).toHaveLength(1)
    expect(a1.toolCalls[0]).toMatchObject({
      callId: 't1',
      name: 'read_file',
      status: 'finished',
      output: '127.0.0.1 localhost',
    })
    expect(a1.finishedAt).toBe(9)
    expect(a1.usage).toEqual({ inputTokens: 50, outputTokens: 10, totalTokens: 60 })

    // second user row
    expect(rows[2]?.data).toMatchObject({ role: 'user', content: 'thanks', messageId: 'u2' })

    // second assistant row — fresh empty pending state
    const a2 = rows[3]?.data as AssistantStepData
    expect(a2.content).toBe('')
    expect(a2.toolCalls).toEqual([])
    expect(a2.agentId).toBe('sup')
  })

  it('is idempotent under double-replay (projectEvents twice yields identical projection)', () => {
    const db = freshDb()
    const events: SessionEvent[] = [
      ev(SID, 'user_message', { messageId: 'u1', content: 'hi', timestamp: 1 }),
      ev(SID, 'step_started', { stepId: 'a1', agentId: 'sup', startedAt: 2 }),
      ev(SID, 'text_ended', { stepId: 'a1', content: 'reply' }),
      ev(SID, 'tool_called', { stepId: 'a1', callId: 't1', name: 'ls', input: '{}', seq: 1 }),
      ev(SID, 'tool_success', { callId: 't1', stepId: 'a1', output: 'dir' }),
    ]

    projectEvents(db, events)
    const firstRun = loadProjection(db, SID)

    projectEvents(db, events)
    const secondRun = loadProjection(db, SID)

    expect(secondRun).toEqual(firstRun)
  })

  it('replay skips unknown event types with a single warn each', () => {
    const db = freshDb()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const events: SessionEvent[] = [
      ev(SID, 'user_message', { messageId: 'u1', content: 'hi', timestamp: 1 }),
      ev(SID, 'unknown_blob', { x: 1 }),
      ev(SID, 'also_unknown', { y: 2 }),
    ]

    projectEvents(db, events)

    expect(loadProjection(db, SID)).toHaveLength(1)
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
})

describe('SessionMessageUpdater (direct)', () => {
  it('apply throws EventPayloadError when a required field is missing', () => {
    const db = freshDb()
    const updater = new SessionMessageUpdater(db)
    // user_message without messageId
    const badEvent = ev(SID, 'user_message', { content: 'x' })

    expect(() => updater.apply(badEvent)).toThrow(/messageId/)
  })

  it('apply routes every SESSION_EVENT_TYPES variant without warning (exhaustive switch smoke)', () => {
    const db = freshDb()
    const updater = new SessionMessageUpdater(db)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const samples: Record<string, Record<string, unknown>> = {
      user_message: { messageId: 'u', content: 'c' },
      step_started: { stepId: 's', agentId: 'a' },
      step_ended: { stepId: 's' },
      step_failed: { stepId: 's' },
      text_started: { stepId: 's' },
      text_ended: { stepId: 's', content: 'x' },
      tool_called: { stepId: 's', callId: 'c', name: 'n', input: '{}', seq: 1 },
      tool_success: { callId: 'c' },
      tool_failed: { callId: 'c' },
      compaction_ended: { summary: 's' },
      agent_switched: {},
      model_switched: {},
    }
    updater.apply({ ...ev(SID, 'step_started', samples['step_started']!) })
    for (const type of Object.keys(samples)) {
      if (type === 'step_started') continue
      const event: SessionEvent = {
        id: `x:${type}`,
        aggregateId: SID,
        seq: ++seqCounter,
        type,
        data: samples[type]!,
      }
      updater.apply(event)
    }
    // No "unhandled event type" warning should fire for any variant in the const.
    const unhandledCalls = warn.mock.calls.filter((args) =>
      String(args[0]).includes('unhandled'),
    )
    expect(unhandledCalls).toHaveLength(0)
    warn.mockRestore()
  })
})

describe('projection isolation', () => {
  it('events from two sessions never cross-pollute', () => {
    const db = freshDb()
    projectEvent(db, ev('s1', 'user_message', { messageId: 'u1', content: 'one', timestamp: 1 }))
    projectEvent(db, ev('s2', 'user_message', { messageId: 'u2', content: 'two', timestamp: 1 }))

    expect(loadProjection(db, 's1').map((r) => r.id)).toEqual(['u1'])
    expect(loadProjection(db, 's2').map((r) => r.id)).toEqual(['u2'])
  })
})
