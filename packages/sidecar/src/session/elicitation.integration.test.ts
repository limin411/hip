// packages/sidecar/src/session/elicitation.integration.test.ts
// G3 integration: the ask_user tool pauses the supervisor turn; resolving the
// question rewrites the deferred ToolMessage so the next turn can continue.
import { describe, it, expect, beforeAll } from 'vitest'
import { AIMessage, HumanMessage } from '@langchain/core/messages'
import { buildGraph, type GraphEmit } from './graph.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import type { Summarizer } from './compaction.js'
import { ElicitationCoordinator } from './elicitation.js'
import { buildElicitationTool } from './tools/elicitation.js'
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

const noopSummarizer: Summarizer = { async summarize() { return '' } }

function fakeRunner(script: AIMessage[]): ModelRunner {
  let i = 0
  return {
    async run(_messages: unknown, opts: ModelRunOptions): Promise<AIMessage> {
      const m = script[Math.min(i, script.length - 1)]
      i++
      if (typeof m.content === 'string' && m.content) opts.onText(m.content)
      return m
    },
  }
}

describe('ask_user elicitation in the supervisor loop', () => {
  it('stops the turn (awaiting_user) when the model asks a question', async () => {
    const coordinator = new ElicitationCoordinator({ timeoutMs: 0 })
    const tools = buildElicitationTool(coordinator)
    const runner = fakeRunner([
      new AIMessage({
        content: '',
        tool_calls: [{ name: 'ask_user', args: { question: 'which approach?' }, id: 'q1' }],
      }),
    ])
    const pauses: string[] = []
    const out = await buildGraph().invoke(
      { messages: [new HumanMessage('do a big thing')], steps: 0 },
      {
        configurable: {
          ctx: {
            sessionId: 'el-test',
            runner,
            tools,
            emit: { ...noopEmit, loopSignal: (e) => { if (e.type === 'loop.pause') pauses.push(`${e.kind}:${e.question}`) } },
            summarizer: noopSummarizer,
            elicitation: coordinator,
          },
        },
      },
    )
    expect(coordinator.paused).toBe(true)
    expect(coordinator.current()?.question).toBe('which approach?')
    expect(out.status).toBe('awaiting_user')
    expect(String(out.pendingQuestion)).toContain('elicitation:')
    expect(pauses).toContain('elicitation:which approach?')
  })

  it('keeps running without a coordinator (tool absent, no pause)', async () => {
    const runner = fakeRunner([
      new AIMessage({
        content: '',
        tool_calls: [{ name: 'ask_user', args: { question: 'x' }, id: 'q1' }],
      }),
      new AIMessage('done'),
    ])
    const out = await buildGraph().invoke(
      { messages: [new HumanMessage('hi')], steps: 0 },
      {
        configurable: {
          ctx: {
            sessionId: 'el-test2',
            runner,
            tools: [], // no ask_user registered
            emit: noopEmit,
            summarizer: noopSummarizer,
          },
        },
      },
    )
    // unknown tool call → loop still terminates (error handling), no pause state
    expect(out.status).not.toBe('awaiting_user')
  })
})
