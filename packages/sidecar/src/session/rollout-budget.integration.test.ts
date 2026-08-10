// packages/sidecar/src/session/rollout-budget.integration.test.ts
// G6 integration: the agent node injects threshold reminders and stops the
// turn once the budget is exhausted.
import { describe, it, expect, beforeAll } from 'vitest'
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import { buildGraph, type GraphEmit } from './graph.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import type { Summarizer } from './compaction.js'
import { RolloutBudget } from './rollout-budget.js'
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

describe('rollout budget in the supervisor loop (G6)', () => {
  it('injects the 50% reminder once, then ends the turn on exhaustion', async () => {
    const budget = new RolloutBudget(1000)
    budget.record(600) // > 50% but < 100%
    const runner = fakeRunner([new AIMessage('first answer'), new AIMessage('second answer')])
    const ends: string[] = []
    const out = await buildGraph(50).invoke(
      { messages: [new HumanMessage('work through it')], steps: 0 },
      {
        configurable: {
          ctx: {
            sessionId: 'budget-test',
            runner,
            tools: [],
            emit: { ...noopEmit, loopSignal: (e: import('./loop-events.js').LoopEvent) => { if (e.type === 'loop.end') ends.push(e.reason) } },
            summarizer: noopSummarizer,
            rolloutBudget: budget,
          },
        },
      },
    )
    const msgs = out.messages as unknown[]
    // Reminder must have been injected before the model call.
    const hasReminder = msgs.some(
      (m) => m instanceof SystemMessage && String(m.content).includes('[budget]'),
    )
    expect(hasReminder).toBe(true)
    // Budget not exhausted → loop runs to completion normally.
    expect(ends).not.toContain('budget')
  })

  it('ends the turn with a budget notice once the cap is hit', async () => {
    const budget = new RolloutBudget(1000)
    budget.record(1000) // exhausted before the turn starts
    const runner = fakeRunner([new AIMessage('should not matter')])
    const ends: string[] = []
    const out = await buildGraph(50).invoke(
      { messages: [new HumanMessage('do it')], steps: 0 },
      {
        configurable: {
          ctx: {
            sessionId: 'budget-test2',
            runner,
            tools: [],
            emit: { ...noopEmit, loopSignal: (e: import('./loop-events.js').LoopEvent) => { if (e.type === 'loop.end') ends.push(e.reason) } },
            summarizer: noopSummarizer,
            rolloutBudget: budget,
          },
        },
      },
    )
    expect(out.status).toBe('awaiting_user')
    expect(ends).toContain('budget')
    const msgs = out.messages as unknown[]
    const notice = msgs.find((m) => m instanceof AIMessage && String(m.content).includes('[budget] Token budget exhausted'))
    expect(notice).toBeDefined()
  })

  it('no budget = unchanged behavior (back-compat)', async () => {
    const runner = fakeRunner([new AIMessage('done')])
    const out = await buildGraph(50).invoke(
      { messages: [new HumanMessage('hi')], steps: 0 },
      {
        configurable: {
          ctx: {
            sessionId: 'budget-test3',
            runner,
            tools: [],
            emit: noopEmit,
            summarizer: noopSummarizer,
          },
        },
      },
    )
    expect(out.status).not.toBe('awaiting_user')
    const msgs = out.messages as unknown[]
    expect(msgs.some((m) => m instanceof SystemMessage && String(m.content).includes('[budget]'))).toBe(false)
  })
})
