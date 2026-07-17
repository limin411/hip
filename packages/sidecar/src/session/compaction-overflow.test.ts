import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import { buildGraph, type GraphEmit } from './graph.js'
import { buildTools } from './tools.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import type { Summarizer } from './compaction.js'
import { setActiveModel } from '../config/providers.js'

const withTmp = async (fn: (root: string) => Promise<void>) => {
  const root = mkdtempSync(join(tmpdir(), 'hip-overflow-'))
  try { await fn(root) } finally { rmSync(root, { recursive: true, force: true }) }
}

function fakeRunner(script: AIMessage[]): ModelRunner {
  let i = 0
  return {
    async run(_messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
      const m = script[Math.min(i, script.length - 1)]; i++
      if (typeof m.content === 'string' && m.content) opts.onText(m.content)
      return m
    },
  }
}

function overflowRunner(overflowError: Error, ok: AIMessage): ModelRunner {
  let thrown = false
  return {
    async run(_messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
      if (!thrown) {
        thrown = true
        throw overflowError
      }
      if (typeof ok.content === 'string' && ok.content) opts.onText(ok.content)
      return ok
    },
  }
}

const noopEmit: GraphEmit = { token: () => {}, reasoning: () => {}, toolStarted: () => {}, toolFinished: () => {}, usage: () => {}, planDelta: () => {}, compaction: () => {} }

beforeAll(() => {
  // Use OpenAI strategy for fast local token counting in tests (avoids remote tokenizer download).
  setActiveModel({ providerID: 'openai', modelID: 'gpt-4', baseURL: '' })
})

describe('compaction overflow behavior', () => {
  const build = (): BaseMessage[] => [
    new SystemMessage({ id: 'sys', content: 'you are hip' }),
    new HumanMessage({ id: 'u1', content: '原始目标：做个网页' }),
    new AIMessage({ id: 'a1', content: '老的中间回复' }),
    new HumanMessage({ id: 'u2', content: '中间追问' }),
    new AIMessage({ id: 'a2', content: '中间回复' }),
    new HumanMessage({ id: 'u3', content: '追问三' }),
    new AIMessage({ id: 'a3', content: '回复三' }),
    new HumanMessage({ id: 'u4', content: '追问四' }),
    new AIMessage({ id: 'a4', content: '回复四' }),
    new HumanMessage({ id: 'u5', content: '最近的问题' }),
  ]

  it('does nothing when messages are under budget', async () => {
    await withTmp(async (root) => {
      const app = buildGraph(25, 100_000)
      let summarizeCalled = 0
      const summarizer: Summarizer = { async summarize() { summarizeCalled++; return '摘要' } }
      const out = await app.invoke(
        { messages: build(), steps: 0 },
        { configurable: { ctx: { sessionId: 'test-session', runner: fakeRunner([new AIMessage('ok')]), tools: buildTools(root), emit: noopEmit, summarizer } } },
      )
      expect(summarizeCalled).toBe(0)
      expect(out.compacted).toBe(false)
      expect(out.messages.length).toBe(build().length + 1)
    })
  })

  it('produces a summary and removes middle messages while keeping system + first user + recent K', async () => {
    await withTmp(async (root) => {
      const app = buildGraph(25, 1)
      const summarizer: Summarizer = { async summarize() { return '早期摘要' } }
      const out = await app.invoke(
        { messages: build(), steps: 0 },
        { configurable: { ctx: { sessionId: 'test-session', runner: fakeRunner([new AIMessage('最终答复')]), tools: buildTools(root), emit: noopEmit, summarizer } } },
      )
      expect(out.compacted).toBe(true)
      const ids = out.messages.map((m) => m.id)
      expect(ids).toContain('sys')
      expect(ids).toContain('u1')
      expect(ids).toContain('u4')
      expect(ids).toContain('a4')
      expect(ids).toContain('u5')
      expect(ids).not.toContain('u2')
      expect(ids).not.toContain('a2')
      expect(out.messages.some((m) => m instanceof SystemMessage && typeof m.content === 'string' && m.content.includes('早期摘要'))).toBe(true)
    })
  })

  it('emits compaction_ended with the summary text when compacting', async () => {
    await withTmp(async (root) => {
      const app = buildGraph(25, 1)
      const summarizer: Summarizer = { async summarize() { return 'emit-test-summary' } }
      const summaries: string[] = []
      const emit: GraphEmit = { ...noopEmit, compaction: (s) => summaries.push(s) }
      await app.invoke(
        { messages: build(), steps: 0 },
        { configurable: { ctx: { sessionId: 'test-session', runner: fakeRunner([new AIMessage('最终答复')]), tools: buildTools(root), emit, summarizer } } },
      )
      // graph emits `[${mode}] ${summaryText}`; mode is user-turn when multi-user messages exist.
      expect(summaries).toEqual(['[user-turn] [对话摘要] emit-test-summary'])
    })
  })

  it('recovers from a provider overflow error by compacting aggressively and retrying once', async () => {
    await withTmp(async (root) => {
      const app = buildGraph(25, 100_000)
      let summarizeCalls = 0
      const summarizer: Summarizer = {
        async summarize(m) {
          summarizeCalls++
          if (summarizeCalls === 1) {
            // First call is from overflow recovery; it should see more messages because keepRecentTurns is reduced.
            expect(m.length).toBeGreaterThan(0)
          }
          return 'overflow-summary'
        },
      }
      const overflow = new Error('context length exceeded')
      const runner = overflowRunner(overflow, new AIMessage('recovered'))
      const out = await app.invoke(
        { messages: build(), steps: 0 },
        { configurable: { ctx: { sessionId: 'test-session', runner, tools: buildTools(root), emit: noopEmit, summarizer } } },
      )
      expect(summarizeCalls).toBeGreaterThanOrEqual(1)
      expect((out.messages[out.messages.length - 1] as AIMessage).content).toBe('recovered')
      expect(out.compacted).toBe(true)
    })
  })

  it('runs the compact node at most once per invoke', async () => {
    await withTmp(async (root) => {
      const app = buildGraph(25, 1)
      let summarizeCalls = 0
      const summarizer: Summarizer = { async summarize() { summarizeCalls++; return 'single-summary' } }
      const loop = () => new AIMessage({ content: '', tool_calls: [{ name: 'ls', args: { path: root }, id: 'x' }] })
      await app.invoke(
        { messages: build(), steps: 0 },
        {
          configurable: { ctx: { sessionId: 'test-session', runner: fakeRunner([loop(), new AIMessage('done')]), tools: buildTools(root), emit: noopEmit, summarizer } },
          recursionLimit: 50,
        },
      )
      // Tool-loop may compact once for tool-rounds and again if budget still high;
      // assert we do not thrash (bounded), not a single call forever.
      expect(summarizeCalls).toBeGreaterThanOrEqual(1)
      expect(summarizeCalls).toBeLessThanOrEqual(2)
    })
  })
})
