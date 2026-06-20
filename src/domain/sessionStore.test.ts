// src/domain/sessionStore.test.ts
import { describe, it, expect } from 'vitest'
import { applyServerMessage, clearPermission, emptySession, useDomainStore, type SessionVM } from './sessionStore'
import type { SessionSummary } from '@hip/protocol'

function baseSession(over: Partial<SessionVM> = {}): SessionVM {
  return {
    id: 's1',
    config: { llmProvider: 'deepseek', model: 'm', tools: [] },
    title: 'T',
    preview: 'P',
    updatedAtMs: 0,
    loaded: true,
    messages: [],
    status: 'idle',
    error: null,
    ...over,
  }
}

describe('applyServerMessage', () => {
  it('token:stream from a supervisor streams into the answer body', () => {
    const s0 = { sessions: [baseSession({ messages: [
      { id: 'u1', role: 'user', content: 'hi', timestamp: 0 },
      { id: 't1', role: 'assistant', content: '', timestamp: 5, agentRuns: [{ agentId: 'supervisor', role: 'supervisor', output: '', startedAt: 5, finishedAt: null, seq: 0, messageId: 't1' }] },
    ] })] }
    const next = applyServerMessage(s0, { type: 'token:stream', sessionId: 's1', agentId: 'supervisor', delta: 'Hel', turnId: 't1' }, 6)
    expect(next.sessions[0].messages.at(-1)!.content).toBe('Hel')
  })

  it('supervisor token appends to the existing streaming assistant message', () => {
    const s0 = { sessions: [baseSession({ messages: [
      { id: 'u1', role: 'user', content: 'hi', timestamp: 0 },
      { id: 't1', role: 'assistant', content: 'Hel', timestamp: 5, agentRuns: [{ agentId: 'supervisor', role: 'supervisor', output: '', startedAt: 5, finishedAt: null, seq: 0, messageId: 't1' }] },
    ] })] }
    const next = applyServerMessage(s0, { type: 'token:stream', sessionId: 's1', agentId: 'supervisor', delta: 'lo', turnId: 't1' }, 6)
    expect(next.sessions[0].messages).toHaveLength(2)
    expect(next.sessions[0].messages.at(-1)!.content).toBe('Hello')
  })

  it('message:complete replaces the streaming assistant message', () => {
    const s0 = { sessions: [baseSession({ messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }, { id: 'asst', role: 'assistant', content: 'partial', timestamp: 5 }] })] }
    const final = { id: 'final', role: 'assistant' as const, content: 'full reply', timestamp: 9 }
    const next = applyServerMessage(s0, { type: 'message:complete', sessionId: 's1', message: final }, 9)
    expect(next.sessions[0].messages).toHaveLength(2)
    expect(next.sessions[0].messages[1]).toEqual(final)
    expect(next.sessions[0].status).toBe('idle')
  })

  it('message:complete carries the stopped flag through finalize', () => {
    const s0 = { sessions: [baseSession({ messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }, { id: 'asst', role: 'assistant', content: 'partial', timestamp: 5 }] })] }
    const next = applyServerMessage(s0, { type: 'message:complete', sessionId: 's1', message: { id: 'asst', role: 'assistant', content: 'partial', agentId: 'supervisor', timestamp: 5, stopped: true } }, 10)
    expect(next.sessions[0].messages.at(-1)).toMatchObject({ content: 'partial', stopped: true })
    expect(next.sessions[0].status).toBe('idle')
  })

  it('ignores events for unknown sessions', () => {
    const s0 = { sessions: [baseSession()] }
    const next = applyServerMessage(s0, { type: 'agent:finished', sessionId: 'nope', agentId: 'a1', turnId: 't1' }, 0)
    expect(next).toBe(s0)
  })

  it('session:created adds an empty session and ignores duplicates', () => {
    const s0 = { sessions: [baseSession()] }
    const added = applyServerMessage(s0, { type: 'session:created', sessionId: 's2' }, 0)
    expect(added.sessions.map((s) => s.id)).toEqual(['s1', 's2'])
    const dup = applyServerMessage(added, { type: 'session:created', sessionId: 's1' }, 0)
    expect(dup.sessions).toHaveLength(2)
  })

  it('token:stream for an unknown agent is a no-op (arrives before agent:started)', () => {
    const s0 = { sessions: [baseSession({ messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }] })] }
    const next = applyServerMessage(s0, { type: 'token:stream', sessionId: 's1', agentId: 'ghost', delta: 'x', turnId: 't1' }, 0)
    expect(next.sessions[0].messages).toHaveLength(1)
  })

  it('error stores code+message on the session so the UI can surface it', () => {
    const next = applyServerMessage(
      { sessions: [baseSession()] },
      { type: 'error', sessionId: 's1', code: 'NO_API_KEY', message: 'DeepSeek API key not configured. Set it in Settings.' },
      0,
    )
    expect(next.sessions[0].status).toBe('error')
    expect(next.sessions[0].error).toEqual({ code: 'NO_API_KEY', message: 'DeepSeek API key not configured. Set it in Settings.' })
  })

  it('error with CANCELLED returns the session to idle without surfacing an error notice', () => {
    const s0 = { sessions: [baseSession({ status: 'running' })] }
    const next = applyServerMessage(s0, { type: 'error', sessionId: 's1', code: 'CANCELLED', message: 'User cancelled the request' }, 0)
    expect(next.sessions[0].status).toBe('idle')
    expect(next.sessions[0].error).toBeNull()
  })

  it('error without a sessionId is ignored (cannot attribute to a session)', () => {
    const s0 = { sessions: [baseSession()] }
    const next = applyServerMessage(s0, { type: 'error', code: 'PARSE_ERROR', message: 'bad json' }, 0)
    expect(next.sessions[0].error).toBeNull()
  })

  it('agent:started clears a prior error (a fresh run is underway)', () => {
    const s0 = { sessions: [baseSession({ status: 'error', error: { code: 'NO_API_KEY', message: 'x' } })] }
    const next = applyServerMessage(s0, { type: 'agent:started', sessionId: 's1', agentId: 'a1', role: 'supervisor', turnId: 't1' }, 0)
    expect(next.sessions[0].error).toBeNull()
  })

  it('session:list:result populates unloaded summaries', () => {
    const next = applyServerMessage(
      { sessions: [] },
      { type: 'session:list:result', sessions: [{ id: 's1', title: 'T', preview: 'P', updatedAt: 1000, messageCount: 2, surface: 'code' }] },
      2000,
    )
    expect(next.sessions[0]).toMatchObject({ id: 's1', title: 'T', loaded: false, updatedAtMs: 1000 })
  })

  it('session:loaded fills messages and marks loaded', () => {
    const base = { sessions: [{ ...emptySession('s1'), loaded: false }] }
    const next = applyServerMessage(base, {
      type: 'session:loaded', sessionId: 's1',
      messages: [
        { id: 'u1', role: 'user', content: 'hi', timestamp: 1 },
        { id: 'a1', role: 'assistant', content: 'reply', timestamp: 2 },
      ],
    }, 0)
    expect(next.sessions[0].loaded).toBe(true)
    expect(next.sessions[0].messages).toHaveLength(2)
    expect(next.sessions[0].status).toBe('idle')
  })

  it('session:loaded marks interrupted when the trailing persisted message is a user turn', () => {
    const s0 = { sessions: [baseSession({ id: 's1', loaded: false, status: 'running' })] }
    const next = applyServerMessage(s0, { type: 'session:loaded', sessionId: 's1', messages: [
      { id: 'u1', role: 'user', content: 'hi', timestamp: 0 },
    ] }, 0)
    expect(next.sessions[0]).toMatchObject({ loaded: true, status: 'error' })
    expect(next.sessions[0].error).toEqual({ code: 'INTERRUPTED', message: '' })
  })

  it('session:loaded settles to idle when the trailing message is an assistant reply', () => {
    const s0 = { sessions: [baseSession({ id: 's1', loaded: false, status: 'running' })] }
    const next = applyServerMessage(s0, { type: 'session:loaded', sessionId: 's1', messages: [
      { id: 'u1', role: 'user', content: 'hi', timestamp: 0 },
      { id: 't1', role: 'assistant', content: 'done', timestamp: 1 },
    ] }, 0)
    expect(next.sessions[0]).toMatchObject({ loaded: true, status: 'idle', error: null })
  })

  it('session:loaded with a trailing stopped assistant settles idle (Stopped badge path)', () => {
    const s0 = { sessions: [baseSession({ id: 's1', loaded: false })] }
    const next = applyServerMessage(s0, { type: 'session:loaded', sessionId: 's1', messages: [
      { id: 'u1', role: 'user', content: 'hi', timestamp: 0 },
      { id: 't1', role: 'assistant', content: 'partial', timestamp: 1, stopped: true },
    ] }, 0)
    expect(next.sessions[0].status).toBe('idle')
  })

  it('session:deleted removes the session', () => {
    const base = { sessions: [emptySession('s1'), emptySession('s2')] }
    const next = applyServerMessage(base, { type: 'session:deleted', sessionId: 's1' }, 0)
    expect(next.sessions.map((s) => s.id)).toEqual(['s2'])
  })

  it('session:title updates the session title', () => {
    const next = applyServerMessage({ sessions: [baseSession()] }, { type: 'session:title', sessionId: 's1', title: 'New Name' }, 0)
    expect(next.sessions[0].title).toBe('New Name')
  })

  it('error CANCELLED coerces the in-flight provisional message tools and marks it stopped', () => {
    // No message:complete arrives on cancel; the CANCELLED branch must finalize the trailing message.
    const s0 = { sessions: [baseSession({ status: 'running', messages: [
      { id: 'u1', role: 'user', content: 'hi', timestamp: 0 },
      { id: 't1', role: 'assistant', content: 'partial', agentId: 'supervisor', timestamp: 5, timeline: [{ kind: 'tool', stepSeq: 0, agentId: 'coder', role: 'coder', callId: 'c1' }], toolCalls: [{ callId: 'c1', agentId: 'coder', name: 'write_file', input: '{}', status: 'running', seq: 0 }] },
    ] })] }
    const next = applyServerMessage(s0, { type: 'error', sessionId: 's1', code: 'CANCELLED', message: 'User cancelled the request' }, 0)
    const m = next.sessions[0].messages.at(-1)!
    expect(m.toolCalls![0]).toMatchObject({ status: 'error', error: 'interrupted' })
    expect(m.stopped).toBe(true)
    expect(next.sessions[0].status).toBe('idle')
  })

  it('error CANCELLED drops an empty provisional assistant message', () => {
    const s0 = { sessions: [baseSession({ status: 'running', messages: [
      { id: 'u1', role: 'user', content: 'hi', timestamp: 0 },
      { id: 't1', role: 'assistant', content: '', agentId: 'supervisor', timestamp: 5, timeline: [], toolCalls: [] },
    ] })] }
    const next = applyServerMessage(s0, { type: 'error', sessionId: 's1', code: 'CANCELLED', message: 'User cancelled the request' }, 0)
    expect(next.sessions[0].messages.map((m) => m.id)).toEqual(['u1'])
    expect(next.sessions[0].status).toBe('idle')
  })

  it('error CANCELLED leaves a prior completed assistant message untouched (not stopped)', () => {
    const s0 = { sessions: [baseSession({ status: 'running', messages: [
      { id: 'u1', role: 'user', content: 'hi', timestamp: 0 },
      { id: 't1', role: 'assistant', content: 'done reply', agentId: 'supervisor', timestamp: 5, timeline: [], toolCalls: [] },
    ] })] }
    const next = applyServerMessage(s0, { type: 'error', sessionId: 's1', code: 'CANCELLED', message: 'User cancelled the request' }, 0)
    const m = next.sessions[0].messages.at(-1)!
    expect(m).toMatchObject({ id: 't1', content: 'done reply' })
    expect(m.stopped).toBeUndefined()
    expect(next.sessions[0].messages).toHaveLength(2)
  })

  it('error CANCELLED marks a reasoning-only provisional (empty content, reasoning timeline, no tools) as stopped', () => {
    // Cancel during reasoning: content is still '' but the timeline has reasoning steps.
    // The old guard required running tools; this new case must also be coerced+stopped.
    const s0 = { sessions: [baseSession({ status: 'running', messages: [
      { id: 'u1', role: 'user', content: 'hi', timestamp: 0 },
      { id: 't1', role: 'assistant', content: '', agentId: 'supervisor', timestamp: 5,
        timeline: [{ kind: 'reasoning', stepSeq: 0, agentId: 'supervisor', role: 'supervisor', content: 'Let me think…' }],
        toolCalls: [] },
    ] })] }
    const next = applyServerMessage(s0, { type: 'error', sessionId: 's1', code: 'CANCELLED', message: 'User cancelled the request' }, 0)
    const m = next.sessions[0].messages.at(-1)!
    expect(m.id).toBe('t1')
    expect(m.stopped).toBe(true)
    expect(next.sessions[0].messages).toHaveLength(2)
    expect(next.sessions[0].status).toBe('idle')
  })

  it('supervisor agent:started creates a provisional assistant message keyed by turnId', () => {
    const s0 = { sessions: [baseSession({ messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }] })] }
    const next = applyServerMessage(s0, { type: 'agent:started', sessionId: 's1', agentId: 'supervisor', role: 'supervisor', turnId: 't1' }, 1000)
    const msgs = next.sessions[0].messages
    expect(msgs).toHaveLength(2)
    expect(msgs[1]).toMatchObject({ id: 't1', role: 'assistant', content: '', timeline: [], toolCalls: [] })
  })
  it('supervisor agent:started reuses an existing message with the same turnId', () => {
    const s0 = { sessions: [baseSession({ messages: [{ id: 't1', role: 'assistant', content: 'partial', timeline: [], toolCalls: [], timestamp: 5 }] })] }
    const next = applyServerMessage(s0, { type: 'agent:started', sessionId: 's1', agentId: 'supervisor', role: 'supervisor', turnId: 't1' }, 1000)
    expect(next.sessions[0].messages).toHaveLength(1)
    expect(next.sessions[0].messages[0]).toMatchObject({ id: 't1', content: 'partial' })
  })
  it('reasoning:delta upserts a reasoning step; same stepSeq concatenates', () => {
    const s0 = { sessions: [baseSession({ messages: [{ id: 't1', role: 'assistant', content: '', timeline: [], toolCalls: [], timestamp: 0 }] })] }
    const a1 = applyServerMessage(s0, { type: 'reasoning:delta', sessionId: 's1', turnId: 't1', agentId: 'supervisor', role: 'supervisor', stepSeq: 0, delta: 'Let me ' }, 0)
    const a2 = applyServerMessage(a1, { type: 'reasoning:delta', sessionId: 's1', turnId: 't1', agentId: 'supervisor', role: 'supervisor', stepSeq: 0, delta: 'think.' }, 0)
    expect(a2.sessions[0].messages[0].timeline).toEqual([{ kind: 'reasoning', stepSeq: 0, agentId: 'supervisor', role: 'supervisor', content: 'Let me think.' }])
  })
  it('tool:started then tool:finished produce one tool step + a finished ToolCall', () => {
    const s0 = { sessions: [baseSession({ messages: [{ id: 't1', role: 'assistant', content: '', timeline: [], toolCalls: [], timestamp: 0 }] })] }
    const started = applyServerMessage(s0, { type: 'tool:started', sessionId: 's1', turnId: 't1', agentId: 'coder', role: 'coder', callId: 'c1', name: 'write_file', input: '{"path":"/a.ts"}', seq: 2 }, 0)
    expect(started.sessions[0].messages[0].timeline).toEqual([{ kind: 'tool', stepSeq: 2, agentId: 'coder', role: 'coder', callId: 'c1' }])
    expect(started.sessions[0].messages[0].toolCalls).toEqual([{ callId: 'c1', agentId: 'coder', name: 'write_file', input: '{"path":"/a.ts"}', status: 'running', seq: 2 }])
    const finished = applyServerMessage(started, { type: 'tool:finished', sessionId: 's1', turnId: 't1', agentId: 'coder', callId: 'c1', status: 'finished', output: 'ok' }, 0)
    expect(finished.sessions[0].messages[0].toolCalls![0]).toMatchObject({ callId: 'c1', status: 'finished', output: 'ok' })
  })
  it('tool:finished sticky-ORs truncated on the message ToolCall', () => {
    // Start a tool with truncated:true, finish it without truncated — result must stay truncated.
    const s0 = { sessions: [baseSession({ messages: [{ id: 't1', role: 'assistant', content: '', timeline: [], toolCalls: [], timestamp: 0 }] })] }
    const started = applyServerMessage(s0, { type: 'tool:started', sessionId: 's1', turnId: 't1', agentId: 'coder', role: 'coder', callId: 'c2', name: 'read_file', input: '{}', seq: 0, truncated: true }, 0)
    const finished = applyServerMessage(started, { type: 'tool:finished', sessionId: 's1', turnId: 't1', agentId: 'coder', callId: 'c2', status: 'finished', output: 'data' }, 0)
    const tc = finished.sessions[0].messages[0].toolCalls![0]
    expect(tc).toMatchObject({ callId: 'c2', status: 'finished', output: 'data' })
    expect(tc.truncated).toBe(true)
    // Also verify: finish sets truncated even when the started ToolCall had none.
    const s1 = { sessions: [baseSession({ messages: [{ id: 't1', role: 'assistant', content: '', timeline: [], toolCalls: [], timestamp: 0 }] })] }
    const started2 = applyServerMessage(s1, { type: 'tool:started', sessionId: 's1', turnId: 't1', agentId: 'coder', role: 'coder', callId: 'c3', name: 'read_file', input: '{}', seq: 1 }, 0)
    const finished2 = applyServerMessage(started2, { type: 'tool:finished', sessionId: 's1', turnId: 't1', agentId: 'coder', callId: 'c3', status: 'finished', output: 'data', truncated: true }, 0)
    const tc2 = finished2.sessions[0].messages[0].toolCalls![0]
    expect(tc2).toMatchObject({ callId: 'c3', status: 'finished', output: 'data' })
    expect(tc2.truncated).toBe(true)
  })
  it('message:complete replaces with authoritative timeline and coerces a running tool', () => {
    const s0 = { sessions: [baseSession({ messages: [
      { id: 'u1', role: 'user', content: 'hi', timestamp: 0 },
      { id: 't1', role: 'assistant', content: 'partial', timeline: [{ kind: 'tool', stepSeq: 0, agentId: 'coder', role: 'coder', callId: 'c1' }], toolCalls: [{ callId: 'c1', agentId: 'coder', name: 'write_file', input: '{}', status: 'running', seq: 0 }], timestamp: 5 },
    ] })] }
    const authoritative = { id: 't1', role: 'assistant' as const, content: 'done', agentId: 'supervisor', timestamp: 9,
      timeline: [{ kind: 'reasoning' as const, stepSeq: 0, agentId: 'supervisor', role: 'supervisor' as const, content: 'thought' }],
      toolCalls: [{ callId: 'c1', agentId: 'coder', name: 'write_file', input: '{}', status: 'running' as const, seq: 0 }] }
    const next = applyServerMessage(s0, { type: 'message:complete', sessionId: 's1', message: authoritative }, 9)
    const m = next.sessions[0].messages.at(-1)!
    expect(m.timeline).toEqual([{ kind: 'reasoning', stepSeq: 0, agentId: 'supervisor', role: 'supervisor', content: 'thought' }])
    expect(m.toolCalls![0]).toMatchObject({ callId: 'c1', status: 'error', error: 'interrupted' })
    expect(next.sessions[0].status).toBe('idle')
  })
  it('session:thinking flips config.thinking', () => {
    const s0 = { sessions: [baseSession()] }
    const off = applyServerMessage(s0, { type: 'session:thinking', sessionId: 's1', thinking: false }, 0)
    expect(off.sessions[0].config.thinking).toBe(false)
  })
  it('session:permissionMode writes config.permissionMode', () => {
    const s0 = { sessions: [baseSession()] }
    const next = applyServerMessage(s0, { type: 'session:permissionMode', sessionId: 's1', permissionMode: 'full' }, 0)
    expect(next.sessions[0].config.permissionMode).toBe('full')
  })

  it('session:permissionMode for an unknown session is a no-op (same reference)', () => {
    const s0 = { sessions: [baseSession()] }
    const next = applyServerMessage(s0, { type: 'session:permissionMode', sessionId: 'nope', permissionMode: 'chat' }, 0)
    expect(next).toBe(s0)
  })
  it('reasoning:delta for an unknown turnId is a no-op', () => {
    const s0 = { sessions: [baseSession({ messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }] })] }
    const next = applyServerMessage(s0, { type: 'reasoning:delta', sessionId: 's1', turnId: 'ghost', agentId: 'supervisor', role: 'supervisor', stepSeq: 0, delta: 'x' }, 0)
    expect(next.sessions[0].messages).toEqual(s0.sessions[0].messages)
  })

  it('agent:started folds a run onto the turn message (supervisor creates the message)', () => {
    const s0 = { sessions: [baseSession({ messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }] })] }
    const next = applyServerMessage(s0, { type: 'agent:started', sessionId: 's1', agentId: 'supervisor', role: 'supervisor', turnId: 't1' }, 100)
    const m = next.sessions[0].messages.at(-1)!
    expect(m.id).toBe('t1')
    expect(m.agentRuns).toMatchObject([{ agentId: 'supervisor', role: 'supervisor', messageId: 't1', finishedAt: null }])
  })

  it('subagent agent:started folds a run with taskInput onto the existing turn message', () => {
    const s0 = { sessions: [baseSession({ messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }, { id: 't1', role: 'assistant', content: '', timestamp: 100, agentRuns: [{ agentId: 'supervisor', role: 'supervisor', output: '', startedAt: 100, finishedAt: null, seq: 0, messageId: 't1' }] }] })] }
    const next = applyServerMessage(s0, { type: 'agent:started', sessionId: 's1', agentId: 'planner-1', role: 'planner', turnId: 't1', parentAgentId: 'supervisor', taskInput: 'make a plan' }, 110)
    const runs = next.sessions[0].messages.at(-1)!.agentRuns!
    expect(runs.map((r) => r.agentId)).toEqual(['supervisor', 'planner-1'])
    expect(runs[1]).toMatchObject({ taskInput: 'make a plan', parentAgentId: 'supervisor', messageId: 't1' })
  })

  it('subagent token:stream appends to that run\'s output, not the answer body', () => {
    const s0 = { sessions: [baseSession({ messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }, { id: 't1', role: 'assistant', content: '', timestamp: 100, agentRuns: [{ agentId: 'planner-1', role: 'planner', output: '', startedAt: 100, finishedAt: null, seq: 1, messageId: 't1' }] }] })] }
    const next = applyServerMessage(s0, { type: 'token:stream', sessionId: 's1', agentId: 'planner-1', delta: 'a plan', turnId: 't1' }, 120)
    const m = next.sessions[0].messages.at(-1)!
    expect(m.content).toBe('') // answer body untouched
    expect(m.agentRuns![0].output).toBe('a plan')
  })

  it('agent:finished sets finishedAt on the run', () => {
    const s0 = { sessions: [baseSession({ messages: [{ id: 't1', role: 'assistant', content: '', timestamp: 100, agentRuns: [{ agentId: 'planner-1', role: 'planner', output: '', startedAt: 100, finishedAt: null, seq: 1, messageId: 't1' }] }] })] }
    const next = applyServerMessage(s0, { type: 'agent:finished', sessionId: 's1', agentId: 'planner-1', turnId: 't1' }, 2600)
    expect(next.sessions[0].messages.at(-1)!.agentRuns![0].finishedAt).toBe(2600)
  })

  it('session:systemPrompt sets config.systemPrompt', () => {
    const s0 = { sessions: [baseSession({ id: 's1' })] }
    const next = applyServerMessage(s0, { type: 'session:systemPrompt', sessionId: 's1', systemPrompt: 'Be terse' }, 0)
    expect(next.sessions[0].config.systemPrompt).toBe('Be terse')
  })

  it('session:systemPrompt null clears config.systemPrompt', () => {
    const s0 = { sessions: [baseSession({ id: 's1', config: { llmProvider: 'deepseek', model: 'm', tools: [], systemPrompt: 'old' } })] }
    const next = applyServerMessage(s0, { type: 'session:systemPrompt', sessionId: 's1', systemPrompt: null }, 0)
    expect(next.sessions[0].config.systemPrompt).toBeUndefined()
  })

  it('session:loaded adopts the server config when present', () => {
    const s0 = { sessions: [baseSession({ id: 's1', loaded: false })] }
    const next = applyServerMessage(s0, { type: 'session:loaded', sessionId: 's1',
      messages: [{ id: 'a1', role: 'assistant', content: 'x', timestamp: 1 }],
      config: { llmProvider: 'deepseek', model: '', tools: [], thinking: false, systemPrompt: 'Z' },
    }, 0)
    expect(next.sessions[0].config).toMatchObject({ thinking: false, systemPrompt: 'Z' })
  })

  it('session:loaded keeps current config when the server omits it', () => {
    const s0 = { sessions: [baseSession({ id: 's1', loaded: false, config: { llmProvider: 'deepseek', model: 'm', tools: [], thinking: true } })] }
    const next = applyServerMessage(s0, { type: 'session:loaded', sessionId: 's1',
      messages: [{ id: 'a1', role: 'assistant', content: 'x', timestamp: 1 }],
    }, 0)
    expect(next.sessions[0].config.thinking).toBe(true)
  })

  it('agent:interrupt records the pending interrupt on the session', () => {
    const s0 = { sessions: [baseSession()] }
    const next = applyServerMessage(s0, { type: 'agent:interrupt', sessionId: 's1', turnId: 't1', agentId: 'supervisor', question: '我该怎么做？' }, 1)
    expect(next.sessions[0].interrupt).toEqual({ turnId: 't1', question: '我该怎么做？', context: undefined })
  })

  it('agent:configOptions stores the agent-advertised config options on the session', () => {
    const s0 = { sessions: [baseSession()] }
    const next = applyServerMessage(s0, { type: 'agent:configOptions', sessionId: 's1', options: [
      { id: 'model', name: 'Model', category: 'model', currentValue: 'a', options: [{ value: 'a', name: 'A' }, { value: 'b', name: 'B' }] },
    ] }, 0)
    expect(next.sessions[0].configOptions![0].currentValue).toBe('a')
    expect(next.sessions[0].configOptions![0].options).toHaveLength(2)
  })

  it('agent:configOptions for an unknown session is a no-op', () => {
    const s0 = { sessions: [baseSession()] }
    const next = applyServerMessage(s0, { type: 'agent:configOptions', sessionId: 'nope', options: [
      { id: 'model', name: 'Model', category: 'model', currentValue: 'a', options: [{ value: 'a', name: 'A' }] },
    ] }, 0)
    expect(next).toBe(s0)
  })

  it('queues a permission request and clears it on respond', () => {
    let s = applyServerMessage({ sessions: [baseSession({ id: 's' })] }, { type: 'permission:request', sessionId: 's', turnId: 't', requestId: 'r',
      tool: { title: 'edit hello.txt', kind: 'edit' }, options: [{ optionId: 'once', name: 'Allow once', kind: 'allow_once' }] }, 0)
    expect(s.sessions[0].pendingPermission?.requestId).toBe('r')
    s = clearPermission(s, 'r')
    expect(s.sessions[0].pendingPermission).toBeNull()
  })

  it('clearPermission only clears the matching requestId', () => {
    const s0 = applyServerMessage({ sessions: [baseSession({ id: 's' })] }, { type: 'permission:request', sessionId: 's', turnId: 't', requestId: 'r',
      tool: { title: 'edit hello.txt', kind: 'edit' }, options: [{ optionId: 'once', name: 'Allow once', kind: 'allow_once' }] }, 0)
    const s1 = clearPermission(s0, 'other')
    expect(s1.sessions[0].pendingPermission?.requestId).toBe('r')
  })

  it('stores agentFrame on pendingPermission for a nested sub-agent request', () => {
    const base = { sessions: [{ id: 's1', config: { llmProvider: 'd', model: 'm', tools: [] }, title: '', preview: '', updatedAtMs: 0, loaded: true, messages: [], status: 'idle', error: null }] } as any
    const next = applyServerMessage(base, {
      type: 'permission:request', sessionId: 's1', turnId: 't', requestId: 'r',
      tool: { title: 'edit', kind: 'edit' }, options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
      agentFrame: { agentId: 'subagent-1', parentAgentId: 'supervisor', name: 'OpenCode' },
    } as any, 0)
    expect(next.sessions[0].pendingPermission?.agentFrame?.name).toBe('OpenCode')
  })

  it('agent:notification appends a synthetic assistant message for completed background tasks', () => {
    const s0 = { sessions: [baseSession()] }
    const next = applyServerMessage(s0, { type: 'agent:notification', sessionId: 's1', taskId: 'bg-1', description: 'format code', status: 'completed' }, 1000)
    expect(next.sessions[0].messages).toHaveLength(1)
    expect(next.sessions[0].messages[0]).toMatchObject({
      id: 'notif-bg-1',
      role: 'assistant',
      content: '[Background task "format code" completed]',
      agentId: 'bg-1',
    })
  })

  it('agent:notification appends a synthetic assistant message for failed background tasks', () => {
    const s0 = { sessions: [baseSession()] }
    const next = applyServerMessage(s0, { type: 'agent:notification', sessionId: 's1', taskId: 'bg-2', description: 'build', status: 'failed', error: 'exit 1' }, 1000)
    expect(next.sessions[0].messages).toHaveLength(1)
    expect(next.sessions[0].messages[0].content).toBe('[Background task "build" failed: exit 1]')
  })

  it('agent:notification for an unknown session is a no-op', () => {
    const s0 = { sessions: [baseSession()] }
    const next = applyServerMessage(s0, { type: 'agent:notification', sessionId: 'nope', taskId: 'bg-1', description: 'x', status: 'completed' }, 1000)
    expect(next).toBe(s0)
  })

  it('plan:delta accumulates streaming plan text by itemId', () => {
    const s0 = { sessions: [baseSession()] }
    let s = applyServerMessage(s0, { type: 'plan:delta', sessionId: 's1', turnId: 't1', itemId: 'p1', delta: 'Step 1' }, 100)
    s = applyServerMessage(s, { type: 'plan:delta', sessionId: 's1', turnId: 't1', itemId: 'p1', delta: ' and step 2' }, 101)
    expect(s.sessions[0].planDeltaDraft).toEqual({ p1: 'Step 1 and step 2' })
  })

  it('plan:delta accumulates separate drafts for different itemIds', () => {
    const s0 = { sessions: [baseSession()] }
    let s = applyServerMessage(s0, { type: 'plan:delta', sessionId: 's1', turnId: 't1', itemId: 'p1', delta: 'A' }, 100)
    s = applyServerMessage(s, { type: 'plan:delta', sessionId: 's1', turnId: 't1', itemId: 'p2', delta: 'B' }, 101)
    expect(s.sessions[0].planDeltaDraft).toEqual({ p1: 'A', p2: 'B' })
  })

  it('plan:published clears the delta draft and sets the authoritative plan', () => {
    const plan = [{ id: 'p1', description: 'Step 1', content: 'Do step 1', status: 'pending' as const }]
    let s = { sessions: [baseSession()] }
    s = applyServerMessage(s, { type: 'plan:delta', sessionId: 's1', turnId: 't1', itemId: 'p1', delta: 'draft' }, 100)
    const next = applyServerMessage(s, { type: 'plan:published', sessionId: 's1', turnId: 't1', plan }, 101)
    expect(next.sessions[0].activeTurnPlan).toEqual(plan)
    expect(next.sessions[0].planDeltaDraft).toEqual({})
  })

  it('message:complete clears the plan delta draft', () => {
    let s = { sessions: [baseSession()] }
    s = applyServerMessage(s, { type: 'plan:delta', sessionId: 's1', turnId: 't1', itemId: 'p1', delta: 'draft' }, 100)
    const next = applyServerMessage(s, { type: 'message:complete', sessionId: 's1', message: { id: 'm1', role: 'assistant', content: 'done', timestamp: 101 } }, 102)
    expect(next.sessions[0].planDeltaDraft).toEqual({})
  })

  it('plan:delta for an unknown session is a no-op', () => {
    const s0 = { sessions: [baseSession()] }
    const next = applyServerMessage(s0, { type: 'plan:delta', sessionId: 'nope', turnId: 't1', itemId: 'p1', delta: 'x' }, 100)
    expect(next).toBe(s0)
  })
})

function reset() {
  useDomainStore.setState({ sessions: [], activeSessionId: null, connection: 'disconnected' })
}

describe('useDomainStore actions', () => {
  it('createSession prepends and activates', () => {
    reset()
    const id = useDomainStore.getState().createSession('s-new', { llmProvider: 'deepseek', model: 'm', tools: [] })
    expect(useDomainStore.getState().sessions[0].id).toBe(id)
    expect(useDomainStore.getState().activeSessionId).toBe(id)
  })

  it('appendUserMessage adds a user message to the session', () => {
    reset()
    useDomainStore.getState().createSession('s1', { llmProvider: 'deepseek', model: 'm', tools: [] })
    useDomainStore.getState().appendUserMessage('s1', 'u1', 'hello')
    const msgs = useDomainStore.getState().sessions.find((s) => s.id === 's1')!.messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatchObject({ role: 'user', content: 'hello' })
  })

  it('appendUserMessage clears a prior error (the user is retrying)', () => {
    reset()
    useDomainStore.getState().createSession('s1', { llmProvider: 'deepseek', model: 'm', tools: [] })
    useDomainStore.getState().apply({ type: 'error', sessionId: 's1', code: 'NO_API_KEY', message: 'x' })
    expect(useDomainStore.getState().sessions[0].error).toEqual({ code: 'NO_API_KEY', message: 'x' })
    useDomainStore.getState().appendUserMessage('s1', 'u2', 'retry')
    expect(useDomainStore.getState().sessions[0].error).toBeNull()
  })

  it('deleteSession removes and reassigns active', () => {
    reset()
    useDomainStore.getState().createSession('s1', { llmProvider: 'deepseek', model: 'm', tools: [] })
    useDomainStore.getState().createSession('s2', { llmProvider: 'deepseek', model: 'm', tools: [] })
    useDomainStore.getState().deleteSession('s2')
    expect(useDomainStore.getState().sessions.map((s) => s.id)).toEqual(['s1'])
    expect(useDomainStore.getState().activeSessionId).toBe('s1')
  })

  it('apply routes a ServerMessage through the reducer', () => {
    reset()
    useDomainStore.getState().createSession('s1', { llmProvider: 'deepseek', model: 'm', tools: [] })
    useDomainStore.getState().apply({ type: 'agent:started', sessionId: 's1', agentId: 'supervisor', role: 'supervisor', turnId: 't1' })
    const m = useDomainStore.getState().sessions[0].messages.at(-1)!
    expect(m.agentRuns).toMatchObject([{ agentId: 'supervisor', role: 'supervisor' }])
    expect(useDomainStore.getState().sessions[0].status).toBe('running')
  })

  it("apply('ready') updates hasApiKey from the sidecar", () => {
    reset()
    useDomainStore.getState().apply({ type: 'ready', hasApiKey: false })
    expect(useDomainStore.getState().hasApiKey).toBe(false)
    useDomainStore.getState().apply({ type: 'ready', hasApiKey: true })
    expect(useDomainStore.getState().hasApiKey).toBe(true)
  })

  it("apply('config:activeModel') refreshes hasApiKey on a live model switch", () => {
    reset()
    useDomainStore.getState().apply({ type: 'ready', hasApiKey: true })
    // Switching the global model to a keyless provider must flip the banner without a reconnect.
    useDomainStore.getState().apply({ type: 'config:activeModel', providerID: 'openai', modelID: 'gpt-4o', hasApiKey: false })
    expect(useDomainStore.getState().hasApiKey).toBe(false)
    // …and back to a keyed provider re-greens it.
    useDomainStore.getState().apply({ type: 'config:activeModel', providerID: 'deepseek', modelID: 'deepseek-reasoner', hasApiKey: true })
    expect(useDomainStore.getState().hasApiKey).toBe(true)
  })

  it('renameSession updates the title optimistically', () => {
    reset()
    useDomainStore.getState().createSession('s1', { llmProvider: 'deepseek', model: 'm', tools: [] })
    useDomainStore.getState().renameSession('s1', 'Renamed')
    expect(useDomainStore.getState().sessions[0].title).toBe('Renamed')
  })
})

describe('applyServerMessage session:cwd', () => {
  it('sets cwd on the matching session config', () => {
    const base = emptySession('s1')
    const next = applyServerMessage({ sessions: [base] }, { type: 'session:cwd', sessionId: 's1', cwd: '/proj' }, 0)
    expect(next.sessions[0].config.cwd).toBe('/proj')
  })
})

describe('regenerateLastTurn', () => {
  it('drops a trailing assistant message and resets to running', () => {
    useDomainStore.setState({
      sessions: [baseSession({
        messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }, { id: 'a1', role: 'assistant', content: 'ans', timestamp: 1 }],
        status: 'idle', error: { code: 'X', message: 'y' },
      })],
      activeSessionId: 's1',
    })
    useDomainStore.getState().regenerateLastTurn('s1')
    const s = useDomainStore.getState().sessions[0]
    expect(s.messages.map((m) => m.id)).toEqual(['u1'])
    expect(s.status).toBe('running')
    expect(s.error).toBeNull()
  })

  it('keeps a trailing user message (retry-after-error path)', () => {
    useDomainStore.setState({
      sessions: [baseSession({ messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }], status: 'error', error: { code: 'AGENT_ERROR', message: 'boom' } })],
      activeSessionId: 's1',
    })
    useDomainStore.getState().regenerateLastTurn('s1')
    const s = useDomainStore.getState().sessions[0]
    expect(s.messages.map((m) => m.id)).toEqual(['u1'])
    expect(s.status).toBe('running')
    expect(s.error).toBeNull()
  })
})

describe('sessionStore surface', () => {
  const summary = (id: string, surface: 'chat' | 'code'): SessionSummary =>
    ({ id, title: 't', preview: '', updatedAt: 1, messageCount: 0, surface })

  it('session:list:result carries surface onto the VM config', () => {
    const next = applyServerMessage({ sessions: [] }, { type: 'session:list:result', sessions: [summary('a', 'chat'), summary('b', 'code')] }, 1)
    expect(next.sessions.find((s) => s.id === 'a')!.config.surface).toBe('chat')
    expect(next.sessions.find((s) => s.id === 'b')!.config.surface).toBe('code')
  })

  it('session:loaded preserves the surface when the loaded config omits it', () => {
    const start = applyServerMessage({ sessions: [] }, { type: 'session:list:result', sessions: [summary('a', 'chat')] }, 1)
    const loaded = applyServerMessage(start, { type: 'session:loaded', sessionId: 'a', messages: [], config: { llmProvider: 'd', model: 'm', tools: [] } }, 2)
    expect(loaded.sessions.find((s) => s.id === 'a')!.config.surface).toBe('chat')
  })
})

describe('agent:profiles reducer', () => {
  it('stores profile list on the session', () => {
    const s0 = { sessions: [baseSession()] }
    const profiles = [
      { id: 'supervisor', name: 'Supervisor', mode: 'primary' as const },
      { id: 'worker', name: 'Worker', mode: 'subagent' as const },
    ]
    const next = applyServerMessage(s0, { type: 'agent:profiles', sessionId: 's1', profiles }, 1)
    expect(next.sessions[0].agentProfiles).toEqual(profiles)
  })

  it('updates profile list on existing session', () => {
    const s0 = { sessions: [baseSession({ agentProfiles: [{ id: 'supervisor', name: 'Supervisor', mode: 'primary' as const }] })] }
    const profiles = [
      { id: 'supervisor', name: 'Supervisor', mode: 'primary' as const },
      { id: 'plan', name: 'Plan', mode: 'primary' as const },
    ]
    const next = applyServerMessage(s0, { type: 'agent:profiles', sessionId: 's1', profiles }, 1)
    expect(next.sessions[0].agentProfiles).toEqual(profiles)
  })
})
