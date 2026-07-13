import { describe, it, expect } from 'vitest'
import type { ToolCall } from '@hip/protocol'
import {
  subagentSpawnObservation,
  trajectoryToObservations,
  loopEventsToObservations,
  observationsToJsonl,
  exportTraceJsonl,
  linkSubagentParentObservation,
  createLoopEventCollector,
  createDebugLoopSignalSink,
  sortObservations,
  type TraceObservation,
} from './trace-export.js'
import { TOOL_BLOB_CAP, type TraceRun } from './tool-trace.js'
import type { LoopEvent } from './loop-events.js'
import type { GraphEmit } from './graph.js'

function run(
  over: Partial<TraceRun> & Pick<TraceRun, 'role'>,
): TraceRun {
  return {
    output: '',
    startedAt: 0,
    finishedAt: null,
    seq: 0,
    toolCalls: new Map(),
    reasoningBursts: [],
    ...over,
  }
}

describe('subagentSpawnObservation', () => {
  it('links parentId from parentAgentId and truncates long task input', () => {
    const big = 't'.repeat(TOOL_BLOB_CAP + 100)
    const o = subagentSpawnObservation({
      agentId: 'worker-1',
      parentAgentId: 'supervisor',
      task: big,
      sessionId: 's1',
      turnId: 't1',
    })
    expect(o).toMatchObject({
      type: 'span',
      id: 'worker-1',
      parentId: 'supervisor',
      name: 'subagent.spawn',
      sessionId: 's1',
      turnId: 't1',
      agentId: 'worker-1',
      truncated: true,
    })
    expect(o.input!.length).toBe(TOOL_BLOB_CAP)
    expect(o.metadata).toMatchObject({ parentAgentId: 'supervisor' })
  })

  it('omits parentId when parentAgentId is absent', () => {
    const o = subagentSpawnObservation({ agentId: 'solo', task: 'hi' })
    expect(o.parentId).toBeUndefined()
    expect(o).not.toHaveProperty('parentId')
  })
})

describe('trajectoryToObservations', () => {
  it('maps parentAgentId → parentId and clips output by default', () => {
    const bigOut = 'x'.repeat(TOOL_BLOB_CAP + 50)
    const traj = new Map<string, TraceRun>([
      ['supervisor', run({ role: 'supervisor', output: 'done', startedAt: 1, finishedAt: 9, seq: 0 })],
      ['coder', run({
        role: 'coder',
        output: bigOut,
        startedAt: 2,
        finishedAt: 8,
        seq: 1,
        parentAgentId: 'supervisor',
        taskInput: 'implement',
        toolCalls: new Map<string, ToolCall>([
          ['c1', { callId: 'c1', agentId: 'coder', name: 'read_file', input: '{}', status: 'finished', seq: 1 }],
        ]),
      })],
    ])
    const obs = trajectoryToObservations(traj)
    expect(obs).toHaveLength(2)
    const coder = obs.find((o) => o.id === 'coder')!
    expect(coder.parentId).toBe('supervisor')
    expect(coder.input).toBe('implement')
    expect(coder.output!.length).toBe(TOOL_BLOB_CAP)
    expect(coder.truncated).toBe(true)
    expect(coder.metadata).toMatchObject({ parentAgentId: 'supervisor', toolCallCount: 1 })
    // Full tool payloads are not dumped into the observation by default.
    expect(JSON.stringify(coder)).not.toContain('read_file')
  })

  it('includeFullBlobs keeps long output when explicitly requested', () => {
    const big = 'y'.repeat(TOOL_BLOB_CAP + 10)
    const traj = new Map<string, TraceRun>([
      ['a', run({ role: 'subagent', output: big, parentAgentId: 'supervisor' })],
    ])
    const obs = trajectoryToObservations(traj, { includeFullBlobs: true })
    expect(obs[0]!.output!.length).toBe(big.length)
    expect(obs[0]!.truncated).toBeUndefined()
  })
})

describe('loopEventsToObservations + observationsToJsonl', () => {
  it('exports loop events as JSONL lines without dual-writing SessionEvent fields', () => {
    const events: LoopEvent[] = [
      { type: 'loop.nudge', sessionId: 's1', turnId: 't1', reason: 'doom' },
      { type: 'loop.pause', sessionId: 's1', turnId: 't1', question: 'stuck?', kind: 'subagent_pause' },
      { type: 'loop.end', sessionId: 's1', turnId: 't1', reason: 'completed' },
    ]
    const obs = loopEventsToObservations(events)
    expect(obs.map((o) => o.name)).toEqual(['loop.nudge', 'loop.pause', 'loop.end'])
    const jsonl = observationsToJsonl(obs)
    const lines = jsonl.trimEnd().split('\n')
    expect(lines).toHaveLength(3)
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow()
    }
    expect(JSON.parse(lines[1]!).input).toBe('stuck?')
  })

  it('clips long pause questions in both input and metadata (no full free-text re-embed)', () => {
    const bigQ = 'q'.repeat(TOOL_BLOB_CAP + 250)
    const obs = loopEventsToObservations([
      { type: 'loop.pause', sessionId: 's1', turnId: 't1', question: bigQ, kind: 'doom' },
    ])
    expect(obs).toHaveLength(1)
    expect(obs[0]!.truncated).toBe(true)
    expect(obs[0]!.input!.length).toBe(TOOL_BLOB_CAP)
    // metadata free-text is clipped to the same cap (not a full re-embed of bigQ)
    expect(typeof obs[0]!.metadata?.question).toBe('string')
    expect((obs[0]!.metadata!.question as string).length).toBe(TOOL_BLOB_CAP)
    expect(obs[0]!.metadata?.question).toBe(obs[0]!.input)
    // Full original question must not appear anywhere in the JSONL line.
    const line = observationsToJsonl(obs)
    expect(line).not.toContain(bigQ)
    expect(line).not.toContain('q'.repeat(TOOL_BLOB_CAP + 1))
  })

  it('exportTraceJsonl combines trajectory spans and loop events', () => {
    const traj = new Map<string, TraceRun>([
      ['worker-1', run({ role: 'subagent', output: 'ok', parentAgentId: 'supervisor', taskInput: 'do', startedAt: 10 })],
    ])
    const jsonl = exportTraceJsonl(traj, [
      { type: 'loop.end', sessionId: 's', turnId: 't', reason: 'completed' },
    ])
    const rows = jsonl.trimEnd().split('\n').map((l) => JSON.parse(l) as TraceObservation)
    expect(rows.some((r) => r.parentId === 'supervisor' && r.id === 'worker-1')).toBe(true)
    expect(rows.some((r) => r.type === 'loop' && r.name === 'loop.end')).toBe(true)
  })
})

describe('sortObservations / merge order', () => {
  it('sorts by startTime ascending with stable index for ties', () => {
    const rows: TraceObservation[] = [
      { type: 'span', id: 'late', name: 'agent.supervisor', startTime: 200 },
      { type: 'loop', id: 'mid', name: 'loop.nudge', startTime: 100 },
      { type: 'span', id: 'early', name: 'agent.coder', startTime: 50 },
      { type: 'loop', id: 'tie-a', name: 'loop.end', startTime: 100 },
    ]
    const sorted = sortObservations(rows)
    expect(sorted.map((o) => o.id)).toEqual(['early', 'mid', 'tie-a', 'late'])
  })

  it('exportTraceJsonl emits a globally time-ordered stream', () => {
    const traj = new Map<string, TraceRun>([
      ['late', run({ role: 'supervisor', output: 'L', startedAt: 500 })],
      ['early', run({ role: 'coder', output: 'E', startedAt: 10, parentAgentId: 'late' })],
    ])
    // trajectoryToObservations sorts spans; loop rows get Date.now() (~now).
    // early (10) should still precede late (500) in the combined export.
    const rows = exportTraceJsonl(traj, []).trimEnd().split('\n').map((l) => JSON.parse(l) as TraceObservation)
    expect(rows.map((r) => r.id)).toEqual(['early', 'late'])
  })
})

describe('linkSubagentParentObservation', () => {
  it('returns a parent-linked span and feeds the optional collector', () => {
    const collected: TraceObservation[] = []
    const o = linkSubagentParentObservation(
      {
        agentId: 'worker-1',
        parentAgentId: 'supervisor',
        task: 'investigate',
        sessionId: 's1',
        turnId: 'turn-1',
      },
      { collect: (x) => collected.push(x) },
    )
    expect(o.parentId).toBe('supervisor')
    expect(collected).toEqual([o])
  })

  it('swallows collector errors (best-effort)', () => {
    expect(() =>
      linkSubagentParentObservation(
        { agentId: 'w', task: 'x', parentAgentId: 'p' },
        {
          collect: () => {
            throw new Error('collector down')
          },
        },
      ),
    ).not.toThrow()
  })
})

describe('createLoopEventCollector / createDebugLoopSignalSink', () => {
  it('createLoopEventCollector appends and is throw-safe via emitLoopSignal', () => {
    const into: LoopEvent[] = []
    const sink = createLoopEventCollector(into)
    sink({ type: 'loop.budget', sessionId: 's', turnId: 't', remaining: 1, total: 10 })
    expect(into).toHaveLength(1)
    expect(into[0]!.type).toBe('loop.budget')
  })

  it('createDebugLoopSignalSink is assignable as GraphEmit.loopSignal and does not throw', () => {
    const emit: GraphEmit = {
      token: () => {},
      reasoning: () => {},
      toolStarted: () => {},
      toolFinished: () => {},
      usage: () => {},
      planDelta: () => {},
      compaction: () => {},
      loopSignal: createDebugLoopSignalSink(),
    }
    expect(() =>
      emit.loopSignal?.({ type: 'loop.end', sessionId: 's', turnId: 't', reason: 'abort' }),
    ).not.toThrow()
  })
})
