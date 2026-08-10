// packages/sidecar/src/session/background-inject.integration.test.ts
// G5 integration: the afterCompact hook appends background-status text after
// an LLM compaction, so the model keeps knowing about running background work.
import { describe, it, expect, beforeAll } from 'vitest'
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import { buildGraph, type GraphEmit } from './graph.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import type { Summarizer } from './compaction.js'
import { setActiveModel } from '../config/providers.js'

const noopEmit: GraphEmit = {
  token: () => {},
  reasoning: () => {},
  toolStarted: () => {},
  toolFinished: () => {},
  usage: () => {},
  planDelta: () => {},
  compaction: () => {},
}

beforeAll(() => {
  setActiveModel({ providerID: 'openai', modelID: 'gpt-4', baseURL: '' })
})

const fakeSummarizer: Summarizer = {
  async summarize() {
    return '[summary] early conversation'
  },
}

function fakeRunner(): ModelRunner {
  return {
    async run(_messages: unknown, opts: ModelRunOptions): Promise<AIMessage> {
      const m = new AIMessage('done')
      if (typeof m.content === 'string' && m.content) opts.onText(m.content)
      return m
    },
  }
}

describe('afterCompact hook (G5)', () => {
  it('appends hook text as a SystemMessage after compaction', async () => {
    const injected: string[] = []
    // Several conversation turns so there is a compressible middle beyond
    // keepRecentTurns (3); tiny absolute budget forces the LLM-compact path.
    const turns = Array.from({ length: 8 }, (_, i) => [
      new HumanMessage(`turn ${i} question about feature ${i} with plenty of context words`),
      new AIMessage(`turn ${i} answer mentioning implementation detail number ${i}`),
    ]).flat()
    const out = await buildGraph(50, 1).invoke(
      { messages: turns, steps: 0 },
      {
        configurable: {
          ctx: {
            sessionId: 'bg-inject-test',
            runner: fakeRunner(),
            tools: [],
            emit: noopEmit,
            summarizer: fakeSummarizer,
            afterCompact: (summaryText: string) => {
              injected.push(summaryText)
              return 'Background tasks still running:\n- task t1 (build docs): running'
            },
          },
        },
      },
    )
    expect(injected.length).toBeGreaterThan(0)
    const msgs = out.messages as unknown[]
    const hasInjection = msgs.some(
      (m) => m instanceof SystemMessage && String(m.content).includes('Background tasks still running'),
    )
    expect(hasInjection).toBe(true)
    // a compaction summary must also be present (extractive or LLM) — i.e.
    // the injected message rides AFTER a real summary, not instead of one
    const summaryCount = msgs.filter((m) => m instanceof SystemMessage && String(m.content).includes('[对话摘要]')).length
    expect(summaryCount).toBeGreaterThan(0)
  })

  it('no hook = no injection (back-compat)', async () => {
    const out = await buildGraph(50, 1).invoke(
      { messages: [new HumanMessage('x')], steps: 0 },
      {
        configurable: {
          ctx: {
            sessionId: 'bg-inject-test2',
            runner: fakeRunner(),
            tools: [],
            emit: noopEmit,
            summarizer: fakeSummarizer,
          },
        },
      },
    )
    const msgs = out.messages as unknown[]
    const hasInjection = msgs.some(
      (m) => m instanceof SystemMessage && String(m.content).includes('Background tasks still running'),
    )
    expect(hasInjection).toBe(false)
  })
})
