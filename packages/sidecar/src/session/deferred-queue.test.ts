import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import { buildTools } from './tools.js'
import { buildGraph, getPendingToolCallIds, resolveDeferred, type GraphEmit } from './graph.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import type { Summarizer } from './compaction.js'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { ToolCallResult } from './tool-runner/tool-runner.js'
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
const noopSummarizer: Summarizer = { async summarize() { return '' } }
const withTmp = async (fn: (root: string) => Promise<void>) => {
  const root = mkdtempSync(join(tmpdir(), 'hip-deferred-'))
  try { await fn(root) } finally { rmSync(root, { recursive: true, force: true }) }
}

beforeAll(() => {
  setActiveModel({ providerID: 'openai', modelID: 'gpt-4', baseURL: '' })
})

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

/** A tool runner that returns undefined for specific call IDs on their first invocation,
 *  simulating a pending async result. Subsequent calls return a real ToolCallResult. */
function createDeferredRunner(
  tools: StructuredToolInterface[],
  deferredCallIds: Set<string>,
): { runToolCall: (call: { name: string; callId: string; args: Record<string, unknown> }) => Promise<ToolCallResult | undefined> } {
  const callCounts = new Map<string, number>()
  const byName = new Map(tools.map((t) => [t.name, t]))
  return {
    async runToolCall(call): Promise<ToolCallResult | undefined> {
      const count = (callCounts.get(call.callId) ?? 0) + 1
      callCounts.set(call.callId, count)
      if (deferredCallIds.has(call.callId) && count === 1) {
        return undefined
      }
      const toolInstance = byName.get(call.name)
      if (!toolInstance) {
        return { content: `Error: unknown tool: ${call.name}`, tool_call_id: call.callId, name: call.name }
      }
      const output = await toolInstance.invoke(call.args)
      const content = typeof output === 'string' ? output : JSON.stringify(output)
      return { content, tool_call_id: call.callId, name: call.name }
    },
  }
}

describe('getPendingToolCallIds', () => {
  it('returns empty set when no AIMessage with tool_calls exists', () => {
    const ids = getPendingToolCallIds([new HumanMessage('hello')])
    expect(ids.size).toBe(0)
  })

  it('returns empty set when all tool calls have matching ToolMessages', () => {
    const messages: BaseMessage[] = [
      new AIMessage({ content: '', tool_calls: [{ name: 'ls', args: {}, id: 'c1' }] }),
      new ToolMessage({ content: 'result', tool_call_id: 'c1', name: 'ls' }),
    ]
    const ids = getPendingToolCallIds(messages)
    expect(ids.size).toBe(0)
  })

  it('returns pending IDs for tool calls without ToolMessages', () => {
    const messages: BaseMessage[] = [
      new AIMessage({ content: '', tool_calls: [
        { name: 'ls', args: {}, id: 'c1' },
        { name: 'grep', args: {}, id: 'c2' },
        { name: 'glob', args: {}, id: 'c3' },
      ] }),
      new ToolMessage({ content: 'result1', tool_call_id: 'c1', name: 'ls' }),
      new ToolMessage({ content: 'result3', tool_call_id: 'c3', name: 'glob' }),
    ]
    const ids = getPendingToolCallIds(messages)
    expect(ids.size).toBe(1)
    expect(ids.has('c2')).toBe(true)
  })

  it('uses the last AIMessage only', () => {
    const messages: BaseMessage[] = [
      new AIMessage({ content: '', tool_calls: [{ name: 'old', args: {}, id: 'old1' }] }),
      new ToolMessage({ content: 'old result', tool_call_id: 'old1', name: 'old' }),
      new AIMessage({ content: '', tool_calls: [{ name: 'new', args: {}, id: 'new1' }] }),
    ]
    const ids = getPendingToolCallIds(messages)
    expect(ids.size).toBe(1)
    expect(ids.has('new1')).toBe(true)
  })
})

describe('resolveDeferred', () => {
  it('returns empty when deferredMessages is empty', () => {
    const state = { messages: [] as BaseMessage[], deferredMessages: [] as BaseMessage[] }
    const result = resolveDeferred(state as any)
    expect(result.deferredMessages).toEqual([])
  })

  it('returns empty when all deferred messages have matching ToolMessages in state', () => {
    const deferred = [new ToolMessage({ content: 'result', tool_call_id: 'd1', name: 'ls' })]
    const messages: BaseMessage[] = [
      new ToolMessage({ content: 'already visible', tool_call_id: 'd1', name: 'ls' }),
    ]
    const state = { messages, deferredMessages: deferred }
    const result = resolveDeferred(state as any)
    expect(result.deferredMessages).toEqual(deferred)
  })

  it('flushes orphaned deferred messages with error annotation', () => {
    const deferred: BaseMessage[] = [
      new ToolMessage({ content: 'stale result', tool_call_id: 'orphan1', name: 'ls' }),
    ]
    const state = { messages: [] as BaseMessage[], deferredMessages: deferred }
    const result = resolveDeferred(state as any)
    expect(result.messages?.length).toBe(1)
    const msg = result.messages![0] as ToolMessage
    expect(msg.content).toContain('[Deferred: tool result never arrived]')
    expect(msg.tool_call_id).toBe('orphan1')
    expect(msg.name).toBe('ls')
    expect(result.deferredMessages).toEqual([])
  })
})

describe('deferred message queue', () => {
  it('defers tool results when not all resolve, agent only sees resolved ones', async () => {
    await withTmp(async (root) => {
      const tools = buildTools(root)
      const deferredCallIds = new Set(['t2'])
      const deferredRunner = createDeferredRunner(tools, deferredCallIds)

      const runner = fakeRunner([
        new AIMessage({ content: '', tool_calls: [
          { name: 'ls', args: { path: '/' }, id: 't1' },
          { name: 'glob', args: { pattern: '*' }, id: 't2' },
          { name: 'grep', args: { pattern: 'x' }, id: 't3' },
        ] }),
      ])

      const out = await buildGraph().invoke(
        { messages: [new HumanMessage('run tools')], steps: 0 },
        {
          configurable: {
            ctx: {
              sessionId: 'test-session',
              runner,
              tools,
              emit: noopEmit,
              summarizer: noopSummarizer,
              toolRunner: deferredRunner as any,
            },
          },
        },
      )

      // Resolved tools t1 and t3 appear in messages
      const toolMsgs = out.messages.filter((m: BaseMessage) => m instanceof ToolMessage)
      const toolIds = toolMsgs.map((m: ToolMessage) => m.tool_call_id)
      expect(toolIds).toContain('t1')
      expect(toolIds).toContain('t3')
      expect(toolIds).not.toContain('t2')

      // deferredMessages tracks all calls: resolved results + pending placeholder for t2
      const deferred = out.deferredMessages ?? []
      const deferredIds = deferred.filter((m: BaseMessage) => m instanceof ToolMessage).map((m: ToolMessage) => m.tool_call_id)
      expect(deferredIds).toContain('t1')
      expect(deferredIds).toContain('t2')
      expect(deferredIds).toContain('t3')
      const t2Placeholder = deferred.find((m: BaseMessage) => m instanceof ToolMessage && m.tool_call_id === 't2') as ToolMessage | undefined
      expect(t2Placeholder?.content).toContain('[Deferred: pending]')
    })
  })

  it('flushes deferred result on next cycle when it finally arrives', async () => {
    await withTmp(async (root) => {
      const tools = buildTools(root)
      const graph = buildGraph()

      // First invoke: t2 deferred
      const deferredRunner1 = createDeferredRunner(tools, new Set(['t2']))
      const runner1 = fakeRunner([
        new AIMessage({ content: '', tool_calls: [
          { name: 'ls', args: { path: '/' }, id: 't1' },
          { name: 'glob', args: { pattern: '*' }, id: 't2' },
          { name: 'grep', args: { pattern: 'x' }, id: 't3' },
        ] }),
      ])

      const out1 = await graph.invoke(
        { messages: [new HumanMessage('run tools')], steps: 0 },
        {
          configurable: {
            ctx: {
              sessionId: 'test-session',
              runner: runner1,
              tools,
              emit: noopEmit,
              summarizer: noopSummarizer,
              toolRunner: deferredRunner1 as any,
            },
          },
        },
      )

      // Deferred tracking has placeholder for t2
      const deferred1 = out1.deferredMessages ?? []
      expect(deferred1.filter((m) => m instanceof ToolMessage).map((m: ToolMessage) => m.tool_call_id)).toContain('t2')

      // Second invoke: t2 resolves this time (no deferred IDs), agent calls same tools
      const runner2 = fakeRunner([
        new AIMessage({ content: '', tool_calls: [
          { name: 'ls', args: { path: '/' }, id: 't1' },
          { name: 'glob', args: { pattern: '*' }, id: 't2' },
          { name: 'grep', args: { pattern: 'x' }, id: 't3' },
        ] }),
        new AIMessage('all done'),
      ])

      const out2 = await graph.invoke(
        { messages: out1.messages, steps: out1.steps },
        {
          configurable: {
            ctx: {
              sessionId: 'test-session',
              runner: runner2,
              tools,
              emit: noopEmit,
              summarizer: noopSummarizer,
            },
          },
          recursionLimit: 30,
        },
      )

      // All 3 tool calls now have ToolMessages visible
      const toolIds2 = out2.messages.filter((m: BaseMessage) => m instanceof ToolMessage).map((m: ToolMessage) => m.tool_call_id)
      expect(toolIds2.filter((id: string) => id === 't1').length).toBeGreaterThanOrEqual(1)
      expect(toolIds2.filter((id: string) => id === 't2').length).toBeGreaterThanOrEqual(1)
      expect(toolIds2.filter((id: string) => id === 't3').length).toBeGreaterThanOrEqual(1)
    })
  })

  it('resolveDeferred flushes orphaned deferred message with error annotation in agent node', async () => {
    await withTmp(async (root) => {
      const tools = buildTools(root)
      const graph = buildGraph()
      const runner = fakeRunner([new AIMessage('done')])

      // Set up state with an orphaned deferred message
      const orphaned = new ToolMessage({ content: 'stale', tool_call_id: 'orphan1', name: 'ls' })
      const out = await graph.invoke(
        {
          messages: [new HumanMessage('hello')],
          steps: 0,
          deferredMessages: [orphaned],
        },
        {
          configurable: {
            ctx: {
              sessionId: 'test-session',
              runner,
              tools,
              emit: noopEmit,
              summarizer: noopSummarizer,
            },
          },
        },
      )

      // The orphaned message should be flushed with error annotation
      const orphanedFlushed = out.messages.filter(
        (m: BaseMessage) => m instanceof ToolMessage && m.content.toString().includes('[Deferred: tool result never arrived]'),
      )
      expect(orphanedFlushed.length).toBe(1)
      expect((orphanedFlushed[0] as ToolMessage).tool_call_id).toBe('orphan1')
    })
  })

  it('single tool call with result does not defer (normal behavior unchanged)', async () => {
    await withTmp(async (root) => {
      const tools = buildTools(root)
      const runner = fakeRunner([
        new AIMessage({ content: '', tool_calls: [
          { name: 'ls', args: { path: '/' }, id: 's1' },
        ] }),
        new AIMessage('done'),
      ])

      const graph = buildGraph()
      const out = await graph.invoke(
        { messages: [new HumanMessage('single tool')], steps: 0 },
        {
          configurable: {
            ctx: {
              sessionId: 'test-session',
              runner,
              tools,
              emit: noopEmit,
              summarizer: noopSummarizer,
            },
          },
          recursionLimit: 30,
        },
      )

      // Normal behavior: ToolMessage present, no deferredMessages
      const toolMsgs = out.messages.filter((m: BaseMessage) => m instanceof ToolMessage)
      expect(toolMsgs.length).toBeGreaterThanOrEqual(1)
      expect(toolMsgs.some((m: ToolMessage) => m.tool_call_id === 's1')).toBe(true)
      const deferred = out.deferredMessages ?? []
      expect(deferred.length).toBe(0)
    })
  })
})
