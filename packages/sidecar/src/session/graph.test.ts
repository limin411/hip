import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, HumanMessage, SystemMessage, type AIMessage as AIMsg, type BaseMessage } from '@langchain/core/messages'
import { buildTools } from './tools.js'
import { buildGraph, type GraphEmit } from './graph.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import type { Summarizer } from './compaction.js'
import type { TurnUsage } from '@hip/protocol'

function fakeRunner(script: AIMsg[]): ModelRunner {
  let i = 0
  return {
    async run(_messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMsg> {
      const m = script[Math.min(i, script.length - 1)]; i++
      if (typeof m.content === 'string' && m.content) opts.onText(m.content)
      return m
    },
  }
}

const noopEmit: GraphEmit = { token: () => {}, reasoning: () => {}, toolStarted: () => {}, toolFinished: () => {}, usage: () => {} }
const noopSummarizer: Summarizer = { async summarize() { return '' } }
const withTmp = async (fn: (root: string) => Promise<void>) => {
  const root = mkdtempSync(join(tmpdir(), 'hip-graph-'))
  try { await fn(root) } finally { rmSync(root, { recursive: true, force: true }) }
}

describe('agent loop graph', () => {
  it('stops immediately when the model returns a plain text answer', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const runner = fakeRunner([new AIMessage('你好，我是助手')])
      const out = await app.invoke(
        { messages: [new HumanMessage('你是谁')], steps: 0 },
        { configurable: { ctx: { runner, tools: buildTools(root), emit: noopEmit, summarizer: noopSummarizer } } },
      )
      expect((out.messages[out.messages.length - 1] as AIMessage).content).toBe('你好，我是助手')
      expect(out.steps).toBe(1)
    })
  })

  it('emits usage from the gathered message usage_metadata', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const msg = new AIMessage('done')
      msg.usage_metadata = { input_tokens: 12, output_tokens: 5, total_tokens: 17 }
      const runner = fakeRunner([msg])
      const seen: Array<{ inputTokens: number; outputTokens: number; totalTokens: number }> = []
      await app.invoke(
        { messages: [new HumanMessage('hi')], steps: 0 },
        { configurable: { ctx: { runner, tools: buildTools(root), emit: { ...noopEmit, usage: (u: TurnUsage) => seen.push(u) }, summarizer: noopSummarizer } } },
      )
      expect(seen).toEqual([{ inputTokens: 12, outputTokens: 5, totalTokens: 17 }])
    })
  })

  it('does not emit usage when the message has no usage_metadata', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const seen: unknown[] = []
      await app.invoke(
        { messages: [new HumanMessage('hi')], steps: 0 },
        { configurable: { ctx: { runner: fakeRunner([new AIMessage('done')]), tools: buildTools(root), emit: { ...noopEmit, usage: (u: TurnUsage) => seen.push(u) }, summarizer: noopSummarizer } } },
      )
      expect(seen).toEqual([])
    })
  })

  it('executes a write_file tool call then loops back and finishes', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const runner = fakeRunner([
        new AIMessage({ content: '', tool_calls: [{ name: 'write_file', args: { path: '/index.html', content: '<h1>me</h1>' }, id: 'c1' }] }),
        new AIMessage('已创建 /index.html'),
      ])
      const started: string[] = []
      const out = await app.invoke(
        { messages: [new HumanMessage('做个 HTML 自我介绍')], steps: 0 },
        { configurable: { ctx: { runner, tools: buildTools(root), emit: { ...noopEmit, toolStarted: (n: string) => started.push(n) }, summarizer: noopSummarizer } } },
      )
      expect(readFileSync(join(root, 'index.html'), 'utf8')).toBe('<h1>me</h1>')
      expect(started).toContain('write_file')
      expect(out.steps).toBe(2)
      expect((out.messages[out.messages.length - 1] as AIMessage).content).toBe('已创建 /index.html')
    })
  })

  it('terminates at the step cap even if the model keeps requesting tools', async () => {
    await withTmp(async (root) => {
      const app = buildGraph(2)
      const loopMsg = new AIMessage({ content: '', tool_calls: [{ name: 'ls', args: { path: '/' }, id: 'x' }] })
      const out = await app.invoke(
        { messages: [new HumanMessage('spin')], steps: 0 },
        { configurable: { ctx: { runner: fakeRunner([loopMsg]), tools: buildTools(root), emit: noopEmit, summarizer: noopSummarizer } }, recursionLimit: 50 },
      )
      expect(out.steps).toBeLessThanOrEqual(2)
    })
  })

  it('nudges once then pauses (awaiting_user) on a repeated identical tool call', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const loop = () => new AIMessage({ content: '', tool_calls: [{ name: 'ls', args: { path: '/' }, id: 'x' }] })
      const out = await app.invoke(
        { messages: [new HumanMessage('一直 ls')], steps: 0 },
        { configurable: { ctx: { runner: fakeRunner([loop(), loop(), loop(), loop()]), tools: buildTools(root), emit: noopEmit, summarizer: noopSummarizer } }, recursionLimit: 90 },
      )
      expect(out.status).toBe('awaiting_user')
      expect(out.pendingQuestion).toBeTruthy()
      expect(out.messages.some((m) => m instanceof SystemMessage && typeof m.content === 'string' && m.content.includes('重复'))).toBe(true)
    })
  })

  it('compacts the middle when over the token budget before answering', async () => {
    await withTmp(async (root) => {
      const app = buildGraph(25, 1)
      let summarizeCalled = 0
      const summarizer: Summarizer = { async summarize() { summarizeCalled++; return '早期摘要' } }
      const msgs: BaseMessage[] = [
        new HumanMessage({ id: 'u1', content: '原始目标' }),
        new AIMessage({ id: 'a1', content: '老回复一' }),
        new HumanMessage({ id: 'u2', content: '追问二' }),
        new AIMessage({ id: 'a2', content: '老回复二' }),
        new HumanMessage({ id: 'u3', content: '追问三' }),
        new AIMessage({ id: 'a3', content: '回复三' }),
        new HumanMessage({ id: 'u4', content: '追问四' }),
      ]
      const out = await app.invoke(
        { messages: msgs, steps: 0 },
        { configurable: { ctx: { runner: fakeRunner([new AIMessage('最终答复')]), tools: buildTools(root), emit: noopEmit, summarizer } } },
      )
      expect(summarizeCalled).toBeGreaterThan(0)
      expect(out.messages.some((m) => m instanceof SystemMessage && typeof m.content === 'string' && m.content.includes('早期摘要'))).toBe(true)
    })
  })
})
