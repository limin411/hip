import { describe, it, expect, beforeAll } from 'vitest'
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { buildGraph, type GraphEmit } from './graph.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import type { Summarizer } from './compaction.js'
import type { StructuredToolInterface } from '@langchain/core/tools'
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

type ToolLog = { name: string; start: number; end: number }

function delayTool(name: string, ms: number, log: ToolLog[]): StructuredToolInterface {
  return tool(
    async () => {
      const start = Date.now()
      await new Promise<void>((resolve) => setTimeout(resolve, ms))
      const end = Date.now()
      log.push({ name, start, end })
      return `result:${name}`
    },
    { name, description: name, schema: z.object({}) },
  )
}

function throwingTool(name: string): StructuredToolInterface {
  return tool(
    async () => {
      throw new Error(`boom:${name}`)
    },
    { name, description: name, schema: z.object({}) },
  )
}

describe('toolsNode parallel execution', () => {
  it('executes three read-only tools concurrently', async () => {
    const log: ToolLog[] = []
    const tools: StructuredToolInterface[] = [
      delayTool('read_file', 100, log),
      delayTool('ls', 100, log),
      delayTool('glob', 100, log),
    ]
    const runner = fakeRunner([
      new AIMessage({
        content: '',
        tool_calls: [
          { name: 'read_file', args: {}, id: 'r1' },
          { name: 'ls', args: {}, id: 'r2' },
          { name: 'glob', args: {}, id: 'r3' },
        ],
      }),
      new AIMessage('done'),
    ])
    const start = Date.now()
    await buildGraph().invoke(
      { messages: [new HumanMessage('read lots')], steps: 0 },
      { configurable: { ctx: { sessionId: 'test-session', runner, tools, emit: noopEmit, summarizer: noopSummarizer } } },
    )
    const elapsed = Date.now() - start
    expect(log.length).toBe(3)
    const latestStart = Math.max(...log.map((l) => l.start - start))
    const earliestEnd = Math.min(...log.map((l) => l.end - start))
    expect(latestStart).toBeLessThan(earliestEnd)
    expect(elapsed).toBeLessThan(300)
  })

  it('executes two write tools sequentially', async () => {
    const log: ToolLog[] = []
    const tools: StructuredToolInterface[] = [
      delayTool('write_file', 80, log),
      delayTool('edit_file', 80, log),
    ]
    const runner = fakeRunner([
      new AIMessage({
        content: '',
        tool_calls: [
          { name: 'write_file', args: {}, id: 'w1' },
          { name: 'edit_file', args: {}, id: 'w2' },
        ],
      }),
      new AIMessage('done'),
    ])
    await buildGraph().invoke(
      { messages: [new HumanMessage('write then edit')], steps: 0 },
      { configurable: { ctx: { sessionId: 'test-session', runner, tools, emit: noopEmit, summarizer: noopSummarizer } } },
    )
    expect(log.length).toBe(2)
    const sorted = [...log].sort((a, b) => a.start - b.start)
    expect(sorted[1].start).toBeGreaterThanOrEqual(sorted[0].end - 5)
  })

  it('executes read-only tools in parallel before sequential write tools', async () => {
    const log: ToolLog[] = []
    const tools: StructuredToolInterface[] = [
      delayTool('read_file', 60, log),
      delayTool('grep', 60, log),
      delayTool('write_file', 40, log),
    ]
    const runner = fakeRunner([
      new AIMessage({
        content: '',
        tool_calls: [
          { name: 'read_file', args: {}, id: 'm1' },
          { name: 'grep', args: {}, id: 'm2' },
          { name: 'write_file', args: {}, id: 'm3' },
        ],
      }),
      new AIMessage('done'),
    ])
    await buildGraph().invoke(
      { messages: [new HumanMessage('read then write')], steps: 0 },
      { configurable: { ctx: { sessionId: 'test-session', runner, tools, emit: noopEmit, summarizer: noopSummarizer } } },
    )
    const reads = log.filter((l) => l.name !== 'write_file')
    expect(reads.length).toBe(2)
    const latestReadStart = Math.max(...reads.map((l) => l.start))
    const earliestReadEnd = Math.min(...reads.map((l) => l.end))
    expect(latestReadStart).toBeLessThan(earliestReadEnd)
    const write = log.find((l) => l.name === 'write_file')
    expect(write).toBeDefined()
    expect(write!.start).toBeGreaterThanOrEqual(Math.max(...reads.map((l) => l.end)) - 5)
  })

  it('returns ToolMessages in original call order, not execution order', async () => {
    const log: ToolLog[] = []
    const tools: StructuredToolInterface[] = [
      delayTool('read_file', 80, log),
      delayTool('write_file', 10, log),
    ]
    const runner = fakeRunner([
      new AIMessage({
        content: '',
        tool_calls: [
          { name: 'read_file', args: {}, id: 'o1' },
          { name: 'write_file', args: {}, id: 'o2' },
        ],
      }),
      new AIMessage('done'),
    ])
    const out = await buildGraph().invoke(
      { messages: [new HumanMessage('preserve order')], steps: 0 },
      { configurable: { ctx: { sessionId: 'test-session', runner, tools, emit: noopEmit, summarizer: noopSummarizer } } },
    )
    const toolMsgs = out.messages.filter((m) => m instanceof ToolMessage)
    expect(toolMsgs.map((m) => m.tool_call_id)).toEqual(['o1', 'o2'])
  })

  it('keeps doom-loop signature tracking intact for repeated parallel batches', async () => {
    const tools: StructuredToolInterface[] = [delayTool('read_file', 0, [])]
    const loop = () =>
      new AIMessage({
        content: '',
        tool_calls: [{ name: 'read_file', args: { path: '/x' }, id: 'd1' }],
      })
    const out = await buildGraph().invoke(
      { messages: [new HumanMessage('loop')], steps: 0 },
      {
        configurable: {
          ctx: { sessionId: 'test-session', runner: fakeRunner([loop(), loop(), loop(), loop()]), tools, emit: noopEmit, summarizer: noopSummarizer },
        },
        recursionLimit: 90,
      },
    )
    expect(out.status).toBe('awaiting_user')
    expect(out.pendingQuestion).toBeTruthy()
    expect(
      out.messages.some(
        (m) => m instanceof SystemMessage && typeof m.content === 'string' && m.content.includes('重复'),
      ),
    ).toBe(true)
  })

  it('completes remaining tools when a parallel read-only tool throws', async () => {
    const log: ToolLog[] = []
    const tools: StructuredToolInterface[] = [
      delayTool('read_file', 30, log),
      throwingTool('ls'),
      delayTool('glob', 30, log),
    ]
    const runner = fakeRunner([
      new AIMessage({
        content: '',
        tool_calls: [
          { name: 'read_file', args: {}, id: 'e1' },
          { name: 'ls', args: {}, id: 'e2' },
          { name: 'glob', args: {}, id: 'e3' },
        ],
      }),
      new AIMessage('done'),
    ])
    const out = await buildGraph().invoke(
      { messages: [new HumanMessage('one fails')], steps: 0 },
      { configurable: { ctx: { sessionId: 'test-session', runner, tools, emit: noopEmit, summarizer: noopSummarizer } } },
    )
    const toolMsgs = out.messages.filter((m) => m instanceof ToolMessage)
    expect(toolMsgs.length).toBe(3)
    expect(toolMsgs[0].content).toBe('result:read_file')
    expect(toolMsgs[1].content).toContain('Error: boom:ls')
    expect(toolMsgs[2].content).toBe('result:glob')
  })

  it('respects the configured concurrency cap', async () => {
    const log: ToolLog[] = []
    const tools: StructuredToolInterface[] = [
      delayTool('read_file', 100, log),
      delayTool('ls', 100, log),
      delayTool('glob', 100, log),
    ]
    const runner = fakeRunner([
      new AIMessage({
        content: '',
        tool_calls: [
          { name: 'read_file', args: {}, id: 'c1' },
          { name: 'ls', args: {}, id: 'c2' },
          { name: 'glob', args: {}, id: 'c3' },
        ],
      }),
      new AIMessage('done'),
    ])
    const start = Date.now()
    await buildGraph().invoke(
      { messages: [new HumanMessage('cap at 2')], steps: 0 },
      {
        configurable: {
          ctx: {
            sessionId: 'test-session',
            runner,
            tools,
            emit: noopEmit,
            summarizer: noopSummarizer,
            toolParallelism: 2,
          },
        },
      },
    )
    const elapsed = Date.now() - start
    expect(log.length).toBe(3)
    expect(elapsed).toBeGreaterThanOrEqual(180)
    expect(elapsed).toBeLessThan(300)
  })
})
