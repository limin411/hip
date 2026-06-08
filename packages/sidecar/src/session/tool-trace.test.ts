import { describe, it, expect } from 'vitest'
import type { ServerMessage, ToolCall } from '@hip/protocol'
import { clip, stringify, consumeToolCalls, trajectoryToRuns, type ToolCallStreamLike, type TraceRun, type TraceRecorder } from './tool-trace.js'

// A fake ToolCallStream whose Promises are already resolved.
function fakeTool(over: Partial<ToolCallStreamLike> & { name: string; callId: string }): ToolCallStreamLike {
  return { input: {}, output: Promise.resolve('ok'), status: Promise.resolve('finished'), error: Promise.resolve(undefined), ...over }
}
async function* iter(...tools: ToolCallStreamLike[]): AsyncIterable<ToolCallStreamLike> { for (const t of tools) yield t }

function recorderInto(runs: Map<string, TraceRun>): TraceRecorder {
  return {
    start(agentId, callId, name, input, seq, truncated) {
      runs.get(agentId)!.toolCalls.set(callId, { callId, agentId, name, input, status: 'running', seq, ...(truncated ? { truncated: true } : {}) })
    },
    finish(agentId, callId, status, output, error, truncated) {
      const tc = runs.get(agentId)!.toolCalls.get(callId)!
      tc.status = status
      if (output !== undefined) tc.output = output
      if (error !== undefined) tc.error = error
      if (truncated || tc.truncated) tc.truncated = true
    },
  }
}
function freshRun(): TraceRun { return { role: 'coder', output: '', startedAt: 0, finishedAt: null, seq: 0, toolCalls: new Map() } }

describe('clip', () => {
  it('passes short strings through untouched', () => {
    expect(clip('hello', 10)).toEqual({ text: 'hello', truncated: false })
  })
  it('clips overlong strings and flags truncated', () => {
    expect(clip('abcdef', 3)).toEqual({ text: 'abc', truncated: true })
  })
})

describe('stringify', () => {
  it('returns strings as-is and JSON-encodes objects', () => {
    expect(stringify('x')).toBe('x')
    expect(stringify({ a: 1 })).toBe('{"a":1}')
  })
})

describe('consumeToolCalls', () => {
  it('emits tool:started then tool:finished, assigns seq, and skips task()', async () => {
    const runs = new Map<string, TraceRun>([['coder', freshRun()]])
    const sent: ServerMessage[] = []
    let seq = 0
    const pending: Promise<void>[] = []
    await consumeToolCalls('coder', iter(
      fakeTool({ name: 'task', callId: 't0' }),                              // filtered out
      fakeTool({ name: 'read_file', callId: 'c1', input: { path: '/a.ts' }, output: Promise.resolve('contents') }),
    ), { sessionId: 's1', send: (m) => sent.push(m), nextSeq: () => seq++, pending, record: recorderInto(runs) })
    await Promise.all(pending)

    const started = sent.filter((m) => m.type === 'tool:started')
    const finished = sent.filter((m) => m.type === 'tool:finished')
    expect(started).toHaveLength(1)
    expect(finished).toHaveLength(1)
    expect(started[0]).toMatchObject({ type: 'tool:started', agentId: 'coder', callId: 'c1', name: 'read_file', input: '{"path":"/a.ts"}', seq: 0 })
    expect(finished[0]).toMatchObject({ type: 'tool:finished', callId: 'c1', status: 'finished', output: 'contents' })
    expect(runs.get('coder')!.toolCalls.get('c1')).toMatchObject({ status: 'finished', output: 'contents', seq: 0 })
  })

  it('reports the error path', async () => {
    const runs = new Map<string, TraceRun>([['coder', freshRun()]])
    const sent: ServerMessage[] = []
    let seq = 5
    const pending: Promise<void>[] = []
    await consumeToolCalls('coder', iter(
      fakeTool({ name: 'write_file', callId: 'c9', status: Promise.resolve('error'), error: Promise.resolve('EACCES') }),
    ), { sessionId: 's1', send: (m) => sent.push(m), nextSeq: () => seq++, pending, record: recorderInto(runs) })
    await Promise.all(pending)
    expect(sent.find((m) => m.type === 'tool:finished')).toMatchObject({ status: 'error', error: 'EACCES' })
    expect(sent.find((m) => m.type === 'tool:started')).toMatchObject({ seq: 5 })
  })

  it('clips an oversized output and flags truncated on the event + record', async () => {
    const runs = new Map<string, TraceRun>([['coder', freshRun()]])
    const sent: ServerMessage[] = []
    const pending: Promise<void>[] = []
    const big = 'x'.repeat(5000)
    await consumeToolCalls('coder', iter(
      fakeTool({ name: 'read_file', callId: 'c1', output: Promise.resolve(big) }),
    ), { sessionId: 's1', send: (m) => sent.push(m), nextSeq: () => 0, pending, record: recorderInto(runs) })
    await Promise.all(pending)
    const fin = sent.find((m) => m.type === 'tool:finished') as Extract<ServerMessage, { type: 'tool:finished' }>
    expect(fin.truncated).toBe(true)
    expect(fin.output!.length).toBe(4096)
    expect(runs.get('coder')!.toolCalls.get('c1')!.truncated).toBe(true)
  })
})

describe('trajectoryToRuns', () => {
  it('sorts tool calls by seq and coerces a dangling running tool to error', () => {
    const runs = new Map<string, TraceRun>([
      ['supervisor', { role: 'supervisor', output: 'final', startedAt: 0, finishedAt: 9, seq: 0, toolCalls: new Map() }],
      ['coder', {
        role: 'coder', output: 'c', startedAt: 1, finishedAt: 8, seq: 1, parentAgentId: 'supervisor', taskInput: 'do it',
        toolCalls: new Map<string, ToolCall>([
          ['c2', { callId: 'c2', agentId: 'coder', name: 'read_file', input: '{}', status: 'finished', output: 'r', seq: 3 }],
          ['c1', { callId: 'c1', agentId: 'coder', name: 'write_file', input: '{}', status: 'running', seq: 2 }],
        ]),
      }],
    ])
    const out = trajectoryToRuns(runs)
    const coder = out.find((r) => r.agentId === 'coder')!
    expect(coder).toMatchObject({ taskInput: 'do it', parentAgentId: 'supervisor' })
    expect(coder.toolCalls!.map((t) => t.callId)).toEqual(['c1', 'c2'])       // sorted by seq
    expect(coder.toolCalls![0]).toMatchObject({ status: 'error', error: 'interrupted' })  // dangling running coerced
    expect(out.find((r) => r.agentId === 'supervisor')!.toolCalls).toEqual([])
  })
})
