import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AIMessage, type AIMessage as AIMsg, type BaseMessage } from '@langchain/core/messages'
import { runSubagent } from './subagent.js'
import type { GraphEmit, GraphCtx } from './graph.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import type { Summarizer } from './compaction.js'
import type { TraceObservation } from './trace-export.js'
import { observationsToJsonl } from './trace-export.js'
import { TOOL_BLOB_CAP } from './tool-trace.js'

const { capturedGraphCtxs } = vi.hoisted(() => ({
  capturedGraphCtxs: [] as Array<GraphCtx>,
}))

vi.mock('./graph.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./graph.js')>()
  const origBuildGraph = actual.buildGraph
  return {
    ...actual,
    buildGraph: (maxSteps?: number, compactBudget?: number) => {
      const g = origBuildGraph(maxSteps, compactBudget)
      const origInvoke: typeof g.invoke = g.invoke.bind(g)
      g.invoke = (state, options) => {
        const ctx = (options as { configurable?: { ctx?: GraphCtx } }).configurable?.ctx
        if (ctx) capturedGraphCtxs.push(ctx)
        return origInvoke(state, options)
      }
      return g
    },
  }
})

function fakeRunner(script: AIMsg[]): ModelRunner {
  let i = 0
  return {
    async run(_messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMsg> {
      opts.signal?.throwIfAborted?.()
      const m = script[Math.min(i, script.length - 1)]
      i++
      if (typeof m.content === 'string' && m.content) opts.onText(m.content)
      return m
    },
  }
}

const noopEmit: GraphEmit = {
  token: () => {},
  reasoning: () => {},
  toolStarted: () => {},
  toolFinished: () => {},
  usage: () => {},
  planDelta: () => {},
  compaction: () => {},
}
const noopSummarizer: Summarizer = { async summarize() { return '' } }

beforeEach(() => {
  capturedGraphCtxs.length = 0
})

describe('runSubagent parent observation links (E2)', () => {
  it('propagates parentAgentId onto GraphCtx and collector span.parentId', async () => {
    const observed: TraceObservation[] = []
    const text = await runSubagent({
      runner: fakeRunner([new AIMessage('done')]),
      root: process.cwd(),
      summarizer: noopSummarizer,
      emit: noopEmit,
      signal: new AbortController().signal,
      description: 'do the thing',
      childMaxSteps: 4,
      sessionId: 's-parent',
      turnId: 'turn-9',
      agentId: 'worker-1',
      parentAgentId: 'supervisor',
      onObservation: (o) => observed.push(o),
    })
    expect(text).toBe('done')
    expect(capturedGraphCtxs[0]).toMatchObject({
      agentId: 'worker-1',
      parentAgentId: 'supervisor',
      sessionId: 's-parent',
      turnId: 'turn-9',
    })
    expect(observed).toHaveLength(1)
    expect(observed[0]).toMatchObject({
      type: 'span',
      id: 'worker-1',
      parentId: 'supervisor',
      name: 'subagent.spawn',
      input: 'do the thing',
    })
  })

  it('truncates long task descriptions on the observation by default', async () => {
    const observed: TraceObservation[] = []
    const big = 'q'.repeat(TOOL_BLOB_CAP + 200)
    await runSubagent({
      runner: fakeRunner([new AIMessage('ok')]),
      root: process.cwd(),
      summarizer: noopSummarizer,
      emit: noopEmit,
      signal: new AbortController().signal,
      description: big,
      childMaxSteps: 2,
      agentId: 'w',
      parentAgentId: 'supervisor',
      onObservation: (o) => observed.push(o),
    })
    expect(observed[0]!.truncated).toBe(true)
    expect(observed[0]!.input!.length).toBe(TOOL_BLOB_CAP)
  })

  it('does not require onObservation (default-preserving product path)', async () => {
    const text = await runSubagent({
      runner: fakeRunner([new AIMessage('plain')]),
      root: process.cwd(),
      summarizer: noopSummarizer,
      emit: noopEmit,
      signal: new AbortController().signal,
      description: 'no collector',
      childMaxSteps: 2,
    })
    expect(text).toBe('plain')
    // default agent id still applied
    expect(capturedGraphCtxs[0]?.agentId).toBe('worker')
  })

  it('serializes collected spans to JSONL with parentId', async () => {
    const observed: TraceObservation[] = []
    await runSubagent({
      runner: fakeRunner([new AIMessage('r')]),
      root: process.cwd(),
      summarizer: noopSummarizer,
      emit: noopEmit,
      signal: new AbortController().signal,
      description: 'task',
      childMaxSteps: 2,
      agentId: 'child-a',
      parentAgentId: 'supervisor',
      onObservation: (o) => observed.push(o),
    })
    const jsonl = observationsToJsonl(observed)
    const row = JSON.parse(jsonl.trim()) as TraceObservation
    expect(row.parentId).toBe('supervisor')
    expect(row.id).toBe('child-a')
  })

  it('notes loopSignal presence without pushing a LoopEvent for spawn', async () => {
    const loopEvents: unknown[] = []
    const emit: GraphEmit = {
      ...noopEmit,
      loopSignal: (e) => {
        loopEvents.push(e)
      },
    }
    await runSubagent({
      runner: fakeRunner([new AIMessage('x')]),
      root: process.cwd(),
      summarizer: noopSummarizer,
      emit,
      signal: new AbortController().signal,
      description: 'with loopSignal',
      childMaxSteps: 2,
      parentAgentId: 'supervisor',
      agentId: 'w1',
    })
    expect(loopEvents).toEqual([])
  })
})
