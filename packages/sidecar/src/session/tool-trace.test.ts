import { describe, it, expect } from 'vitest'
import type { ServerMessage, ToolCall } from '@hip/protocol'
import { clip, stringify, consumeToolCalls, trajectoryToRuns, trajectoryToTimeline, REASONING_CAP, clipReasoning, ReasoningTracker, type ToolCallStreamLike, type TraceRun, type TraceRecorder, type ReasoningBurst } from './tool-trace.js'

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
function freshRun(): TraceRun { return { role: 'coder', output: '', startedAt: 0, finishedAt: null, seq: 0, toolCalls: new Map(), reasoningBursts: [] } }

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
  it('falls back to String(v) for non-JSON-serializable values', () => {
    const circ: Record<string, unknown> = {}
    circ.self = circ
    expect(stringify(circ)).toBe('[object Object]')
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
    ), { sessionId: 's1', turnId: 'turn1', roleOf: () => 'coder', onToolStart: () => {}, send: (m) => sent.push(m), nextSeq: () => seq++, pending, record: recorderInto(runs) })
    await Promise.all(pending)

    const started = sent.filter((m) => m.type === 'tool:started')
    const finished = sent.filter((m) => m.type === 'tool:finished')
    expect(started).toHaveLength(1)
    expect(finished).toHaveLength(1)
    expect(started[0]).toMatchObject({ type: 'tool:started', turnId: 'turn1', role: 'coder', agentId: 'coder', callId: 'c1', name: 'read_file', input: '{"path":"/a.ts"}', seq: 0 })
    expect(finished[0]).toMatchObject({ type: 'tool:finished', turnId: 'turn1', callId: 'c1', status: 'finished', output: 'contents' })
    expect(runs.get('coder')!.toolCalls.get('c1')).toMatchObject({ status: 'finished', output: 'contents', seq: 0 })
    expect(sent.indexOf(started[0])).toBeLessThan(sent.indexOf(finished[0]))
  })

  it('reports the error path', async () => {
    const runs = new Map<string, TraceRun>([['coder', freshRun()]])
    const sent: ServerMessage[] = []
    let seq = 5
    const pending: Promise<void>[] = []
    await consumeToolCalls('coder', iter(
      fakeTool({ name: 'write_file', callId: 'c9', status: Promise.resolve('error'), error: Promise.resolve('EACCES') }),
    ), { sessionId: 's1', turnId: 'turn1', roleOf: () => 'coder', onToolStart: () => {}, send: (m) => sent.push(m), nextSeq: () => seq++, pending, record: recorderInto(runs) })
    await Promise.all(pending)
    expect(sent.find((m) => m.type === 'tool:finished')).toMatchObject({ turnId: 'turn1', status: 'error', error: 'EACCES' })
    expect(sent.find((m) => m.type === 'tool:started')).toMatchObject({ turnId: 'turn1', role: 'coder', seq: 5 })
    const fin = sent.find((m) => m.type === 'tool:finished') as Extract<ServerMessage, { type: 'tool:finished' }>
    expect(fin.output).toBeUndefined()
  })

  it('clips an oversized output and flags truncated on the event + record', async () => {
    const runs = new Map<string, TraceRun>([['coder', freshRun()]])
    const sent: ServerMessage[] = []
    const pending: Promise<void>[] = []
    const big = 'x'.repeat(5000)
    await consumeToolCalls('coder', iter(
      fakeTool({ name: 'read_file', callId: 'c1', output: Promise.resolve(big) }),
    ), { sessionId: 's1', turnId: 'turn1', roleOf: () => 'coder', onToolStart: () => {}, send: (m) => sent.push(m), nextSeq: () => 0, pending, record: recorderInto(runs) })
    await Promise.all(pending)
    const fin = sent.find((m) => m.type === 'tool:finished') as Extract<ServerMessage, { type: 'tool:finished' }>
    expect(fin.truncated).toBe(true)
    expect(fin.output!.length).toBe(4096)
    expect(runs.get('coder')!.toolCalls.get('c1')!.truncated).toBe(true)
  })

  it('clips an oversized input and flags truncated on tool:started', async () => {
    const runs = new Map<string, TraceRun>([['coder', freshRun()]])
    const sent: ServerMessage[] = []
    const pending: Promise<void>[] = []
    await consumeToolCalls('coder', iter(
      fakeTool({ name: 'write_file', callId: 'c1', input: { blob: 'y'.repeat(5000) } }),
    ), { sessionId: 's1', turnId: 'turn1', roleOf: () => 'coder', onToolStart: () => {}, send: (m) => sent.push(m), nextSeq: () => 0, pending, record: recorderInto(runs) })
    await Promise.all(pending)
    const started = sent.find((m) => m.type === 'tool:started') as Extract<ServerMessage, { type: 'tool:started' }>
    expect(started.truncated).toBe(true)
    expect(started.input.length).toBe(4096)
    expect(runs.get('coder')!.toolCalls.get('c1')!.truncated).toBe(true)
  })

  it('swallows a rejected output Promise on the error path (no unhandled rejection)', async () => {
    const runs = new Map<string, TraceRun>([['coder', freshRun()]])
    const sent: ServerMessage[] = []
    const pending: Promise<void>[] = []
    await consumeToolCalls('coder', iter(
      fakeTool({ name: 'write_file', callId: 'c1', status: Promise.resolve('error'), error: Promise.resolve('boom'), output: Promise.reject(new Error('torn down')) }),
    ), { sessionId: 's1', turnId: 'turn1', roleOf: () => 'coder', onToolStart: () => {}, send: (m) => sent.push(m), nextSeq: () => 0, pending, record: recorderInto(runs) })
    await Promise.allSettled(pending)
    // let any unhandled rejection surface before the test ends
    await new Promise((r) => setTimeout(r, 10))
    expect(sent.find((m) => m.type === 'tool:finished')).toMatchObject({ turnId: 'turn1', status: 'error', error: 'boom' })
  })

  it('does not emit tool:finished for a non-terminal (running) status', async () => {
    const runs = new Map<string, TraceRun>([['coder', freshRun()]])
    const sent: ServerMessage[] = []
    const pending: Promise<void>[] = []
    await consumeToolCalls('coder', iter(
      fakeTool({ name: 'read_file', callId: 'c1', status: Promise.resolve('running') }),
    ), { sessionId: 's1', turnId: 'turn1', roleOf: () => 'coder', onToolStart: () => {}, send: (m) => sent.push(m), nextSeq: () => 0, pending, record: recorderInto(runs) })
    await Promise.all(pending)
    expect(sent.some((m) => m.type === 'tool:finished')).toBe(false)
    expect(runs.get('coder')!.toolCalls.get('c1')!.status).toBe('running')
  })
})

describe('trajectoryToRuns', () => {
  it('sorts tool calls by seq and coerces a dangling running tool to error', () => {
    const runs = new Map<string, TraceRun>([
      ['supervisor', { role: 'supervisor', output: 'final', startedAt: 0, finishedAt: 9, seq: 0, toolCalls: new Map(), reasoningBursts: [] }],
      ['coder', {
        role: 'coder', output: 'c', startedAt: 1, finishedAt: 8, seq: 1, parentAgentId: 'supervisor', taskInput: 'do it',
        toolCalls: new Map<string, ToolCall>([
          ['c2', { callId: 'c2', agentId: 'coder', name: 'read_file', input: '{}', status: 'finished', output: 'r', seq: 3 }],
          ['c1', { callId: 'c1', agentId: 'coder', name: 'write_file', input: '{}', status: 'running', seq: 2 }],
        ]),
        reasoningBursts: [],
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

describe('clipReasoning', () => {
  it('passes short reasoning through untouched', () => {
    expect(clipReasoning('thinking…')).toEqual({ text: 'thinking…', truncated: false })
  })
  it('clips reasoning at REASONING_CAP and flags truncated', () => {
    const big = 'r'.repeat(REASONING_CAP + 500)
    const out = clipReasoning(big)
    expect(out.truncated).toBe(true)
    expect(out.text.length).toBe(REASONING_CAP)
  })
})

describe('ReasoningTracker', () => {
  const counter = () => { let s = 0; return () => s++ }

  it('opens a burst on the first delta drawing the next seq; a second push appends at the SAME stepSeq', () => {
    const t = new ReasoningTracker(counter())
    expect(t.push('a', 'hel')).toBe(0)   // opens, draws seq 0
    expect(t.push('a', 'lo')).toBe(0)    // appends, same seq, no new draw
    expect(t.close('a')).toEqual({ stepSeq: 0, content: 'hello' })
  })

  it('draws different stepSeqs for two agents from the shared counter, in call order', () => {
    const t = new ReasoningTracker(counter())
    expect(t.push('a', 'x')).toBe(0)
    expect(t.push('b', 'y')).toBe(1)
  })

  it('close returns the full concatenated content with no truncated key when under cap', () => {
    const t = new ReasoningTracker(counter())
    t.push('a', 'foo')
    t.push('a', 'bar')
    const burst = t.close('a')
    expect(burst).toEqual({ stepSeq: 0, content: 'foobar' })
    expect(burst).not.toHaveProperty('truncated')
  })

  it('close clips content over REASONING_CAP to exactly the cap and flags truncated', () => {
    const t = new ReasoningTracker(counter())
    t.push('a', 'r'.repeat(REASONING_CAP + 100))
    const burst = t.close('a')!
    expect(burst.content.length).toBe(REASONING_CAP)
    expect(burst.truncated).toBe(true)
  })

  it('close on an agent with no open burst returns undefined', () => {
    const t = new ReasoningTracker(counter())
    expect(t.close('nobody')).toBeUndefined()
  })

  it('a push after close opens a NEW burst with a NEW higher stepSeq (reasoning→tool→reasoning)', () => {
    const t = new ReasoningTracker(counter())
    expect(t.push('a', 'first')).toBe(0)
    t.close('a')
    expect(t.push('a', 'second')).toBe(1)   // new burst, new seq
    expect(t.close('a')).toEqual({ stepSeq: 1, content: 'second' })
  })

  it('interleaves with a tool drawing a seq directly between two bursts of the same agent', () => {
    let s = 0
    const next = () => s++
    const t = new ReasoningTracker(next)
    const first = t.push('a', 'plan')   // 0
    t.close('a')
    next()                              // 1 — simulate a tool claiming the next seq
    const second = t.push('a', 'more')  // 2
    expect(first).toBe(0)
    expect(second).toBe(2)
  })
})

describe('trajectoryToTimeline', () => {
  function run(over: Partial<TraceRun> & { role: TraceRun['role'] }): TraceRun {
    return { output: '', startedAt: 0, finishedAt: null, seq: 0, toolCalls: new Map(), reasoningBursts: [], ...over }
  }
  it('returns [] for an empty trajectory', () => {
    expect(trajectoryToTimeline(new Map())).toEqual([])
  })
  it('interleaves reasoning + tool steps across two agents by stepSeq', () => {
    const trajectory = new Map<string, TraceRun>([
      ['supervisor', run({ role: 'supervisor', reasoningBursts: [{ stepSeq: 0, content: 'plan the work' }] })],
      ['coder', run({
        role: 'coder',
        reasoningBursts: [{ stepSeq: 2, content: 'now I write the file' }],
        toolCalls: new Map<string, ToolCall>([['c1', { callId: 'c1', agentId: 'coder', name: 'write_file', input: '{}', status: 'finished', output: 'ok', seq: 1 }]]),
      })],
    ])
    expect(trajectoryToTimeline(trajectory)).toEqual([
      { kind: 'reasoning', stepSeq: 0, agentId: 'supervisor', role: 'supervisor', content: 'plan the work' },
      { kind: 'tool', stepSeq: 1, agentId: 'coder', role: 'coder', callId: 'c1' },
      { kind: 'reasoning', stepSeq: 2, agentId: 'coder', role: 'coder', content: 'now I write the file' },
    ])
  })
  it('uses each tool call seq as its stepSeq', () => {
    const trajectory = new Map<string, TraceRun>([
      ['coder', run({
        role: 'coder',
        toolCalls: new Map<string, ToolCall>([
          ['c2', { callId: 'c2', agentId: 'coder', name: 'read_file', input: '{}', status: 'finished', output: 'r', seq: 7 }],
          ['c1', { callId: 'c1', agentId: 'coder', name: 'write_file', input: '{}', status: 'finished', output: 'w', seq: 4 }],
        ]),
      })],
    ])
    expect(trajectoryToTimeline(trajectory)).toEqual([
      { kind: 'tool', stepSeq: 4, agentId: 'coder', role: 'coder', callId: 'c1' },
      { kind: 'tool', stepSeq: 7, agentId: 'coder', role: 'coder', callId: 'c2' },
    ])
  })
  it('propagates the sticky truncated flag on a reasoning burst', () => {
    const trajectory = new Map<string, TraceRun>([['supervisor', run({ role: 'supervisor', reasoningBursts: [{ stepSeq: 0, content: 'clipped…', truncated: true }] })]])
    expect(trajectoryToTimeline(trajectory)[0]).toEqual({ kind: 'reasoning', stepSeq: 0, agentId: 'supervisor', role: 'supervisor', content: 'clipped…', truncated: true })
  })
  it('omits the truncated key when a reasoning burst was not clipped', () => {
    const trajectory = new Map<string, TraceRun>([['supervisor', run({ role: 'supervisor', reasoningBursts: [{ stepSeq: 0, content: 'short' }] })]])
    expect(trajectoryToTimeline(trajectory)[0]).not.toHaveProperty('truncated')
  })
})
