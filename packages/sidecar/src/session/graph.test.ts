import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, HumanMessage, SystemMessage, type AIMessage as AIMsg, type BaseMessage } from '@langchain/core/messages'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { buildTools } from './tools.js'
import { buildGraph, type GraphEmit, type GraphCtx } from './graph.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import type { Summarizer } from './compaction.js'
import type { TurnUsage } from '@hip/protocol'
import { setActiveModel } from '../config/providers.js'
import { TurnReplanGuard } from './planner.js'
import { ERROR_STREAK_NUDGE, DOOM_LOOP_NUDGE, sigOf } from './doom-loop.js'
import { SUBAGENT_PAUSE_MARKER } from './subagent-result.js'
import type { LoopEvent } from './loop-events.js'

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

const noopEmit: GraphEmit = { token: () => {}, reasoning: () => {}, toolStarted: () => {}, toolFinished: () => {}, usage: () => {}, planDelta: () => {}, compaction: () => {} }
const noopSummarizer: Summarizer = { async summarize() { return '' } }
const withTmp = async (fn: (root: string) => Promise<void>) => {
  const root = mkdtempSync(join(tmpdir(), 'hip-graph-'))
  try { await fn(root) } finally { rmSync(root, { recursive: true, force: true }) }
}

beforeAll(() => {
  setActiveModel({ providerID: 'openai', modelID: 'gpt-4', baseURL: '' })
})

describe('agent loop graph', () => {
  it('stops immediately when the model returns a plain text answer', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const runner = fakeRunner([new AIMessage('你好，我是助手')])
      const out = await app.invoke(
        { messages: [new HumanMessage('你是谁')], steps: 0 },
        { configurable: { ctx: { sessionId: 'test-session', runner, tools: buildTools(root), emit: noopEmit, summarizer: noopSummarizer } } },
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
        { configurable: { ctx: { sessionId: 'test-session', runner, tools: buildTools(root), emit: { ...noopEmit, usage: (u: TurnUsage) => seen.push(u) }, summarizer: noopSummarizer } } },
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
        { configurable: { ctx: { sessionId: 'test-session', runner: fakeRunner([new AIMessage('done')]), tools: buildTools(root), emit: { ...noopEmit, usage: (u: TurnUsage) => seen.push(u) }, summarizer: noopSummarizer } } },
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
        { configurable: { ctx: { sessionId: 'test-session', runner, tools: buildTools(root), emit: { ...noopEmit, toolStarted: (n: string) => started.push(n) }, summarizer: noopSummarizer } } },
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
        { configurable: { ctx: { sessionId: 'test-session', runner: fakeRunner([loopMsg]), tools: buildTools(root), emit: noopEmit, summarizer: noopSummarizer } }, recursionLimit: 50 },
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
        { configurable: { ctx: { sessionId: 'test-session', runner: fakeRunner([loop(), loop(), loop(), loop()]), tools: buildTools(root), emit: noopEmit, summarizer: noopSummarizer } }, recursionLimit: 90 },
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
        { configurable: { ctx: { sessionId: 'test-session', runner: fakeRunner([new AIMessage('最终答复')]), tools: buildTools(root), emit: noopEmit, summarizer } } },
      )
      expect(summarizeCalled).toBeGreaterThan(0)
      expect(out.messages.some((m) => m instanceof SystemMessage && typeof m.content === 'string' && m.content.includes('早期摘要'))).toBe(true)
    })
  })

  it('routeAfterCompact always routes to agent (planNode removed)', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const runner = fakeRunner([new AIMessage('hello from agent')])
      const out = await app.invoke(
        {
          messages: [new HumanMessage('create a project with multiple files')],
          steps: 0,
          planningMode: 'plan',
          planStatus: 'none',
        },
        { configurable: { ctx: { sessionId: 'test-session', runner, tools: buildTools(root), emit: noopEmit, summarizer: noopSummarizer } } },
      )
      expect(out.status).toBe('running')
      expect((out.messages[out.messages.length - 1] as AIMessage).content).toBe('hello from agent')
    })
  })

  it('plan amendment continues through agent node (planNode removed)', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const runner = fakeRunner([new AIMessage('amended plan accepted')])
      const out = await app.invoke(
        {
          messages: [new HumanMessage('plan something'), new HumanMessage('add more detail')],
          steps: 0,
          planningMode: 'plan',
          planStatus: 'generating',
        },
        { configurable: { ctx: { sessionId: 'test-session', runner, tools: buildTools(root), emit: noopEmit, summarizer: noopSummarizer } } },
      )
      expect(out.status).toBe('running')
      expect(out.messages.some((m) => m instanceof HumanMessage && m.content === 'add more detail')).toBe(true)
    })
  })

  it('fast path skips the plan node', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const runner = fakeRunner([new AIMessage('hi there')])
      const out = await app.invoke(
        {
          messages: [new HumanMessage('hello')],
          steps: 0,
          planningMode: 'fast',
          planStatus: 'none',
        },
        { configurable: { ctx: { sessionId: 'test-session', runner, tools: buildTools(root), emit: noopEmit, summarizer: noopSummarizer } } },
      )
      expect(out.planningMode).toBe('fast')
      expect(out.planStatus).toBe('none')
      expect(out.status).toBe('running')
      expect((out.messages[out.messages.length - 1] as AIMessage).content).toBe('hi there')
    })
  })

  it('verify routing continues execution when plan is approved but incomplete', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const runner = fakeRunner([
        new AIMessage({ content: '', tool_calls: [{ name: 'ls', args: { path: '/' }, id: 'v1' }] }),
        new AIMessage('done'),
      ])
      const out = await app.invoke(
        {
          messages: [new HumanMessage('do planned work')],
          steps: 0,
          planningMode: 'plan',
          planStatus: 'approved',
          plan: [{ content: 'step one', status: 'pending' }],
        },
        { configurable: { ctx: { sessionId: 'test-session', runner, tools: buildTools(root), emit: noopEmit, summarizer: noopSummarizer } }, recursionLimit: 30 },
      )
      expect(out.planningMode).toBe('plan')
      expect(out.steps).toBeGreaterThanOrEqual(2)
      expect((out.messages[out.messages.length - 1] as AIMessage).content).toBe('done')
    })
  })

  it('verify routing pauses on tool failure in plan mode', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const runner = fakeRunner([
        new AIMessage({ content: '', tool_calls: [{ name: 'missing_tool', args: {}, id: 'v2' }] }),
      ])
      const out = await app.invoke(
        {
          messages: [new HumanMessage('do planned work')],
          steps: 0,
          planningMode: 'plan',
          planStatus: 'approved',
          plan: [{ content: 'step one', status: 'pending' }],
        },
        { configurable: { ctx: { sessionId: 'test-session', runner, tools: buildTools(root), emit: noopEmit, summarizer: noopSummarizer } }, recursionLimit: 20 },
      )
      expect(out.status).toBe('awaiting_user')
      expect(out.pendingQuestion).toBeTruthy()
    })
  })

  it('planPause still reachable via routeAfterTools when planStatus is ready', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const runner = fakeRunner([
        new AIMessage({ content: '', tool_calls: [{ name: 'ls', args: { path: '/' }, id: 'pp1' }] }),
      ])
      const out = await app.invoke(
        {
          messages: [new HumanMessage('check plan readiness')],
          steps: 0,
          planningMode: 'plan',
          planStatus: 'ready',
        },
        { configurable: { ctx: { sessionId: 'test-session', runner, tools: buildTools(root), emit: noopEmit, summarizer: noopSummarizer } } },
      )
      expect(out.status).toBe('awaiting_user')
      expect(out.planningMode).toBe('plan')
      expect(out.planStatus).toBe('ready')
    })
  })

  it('verify routing ends the turn when all plan items are completed', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const runner = fakeRunner([
        new AIMessage({ content: '', tool_calls: [{ name: 'ls', args: { path: '/' }, id: 'v3' }] }),
      ])
      const out = await app.invoke(
        {
          messages: [new HumanMessage('finish the plan')],
          steps: 0,
          planningMode: 'plan',
          planStatus: 'approved',
          plan: [{ content: 'step one', status: 'completed' }],
        },
        { configurable: { ctx: { sessionId: 'test-session', runner, tools: buildTools(root), emit: noopEmit, summarizer: noopSummarizer } }, recursionLimit: 20 },
      )
      expect(out.status).toBe('running')
      expect(out.steps).toBe(1)
    })
  })

  it('todoToPlanItem: guards against array items (no "undefined" content)', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const runner = fakeRunner([
        new AIMessage({ content: '', tool_calls: [{ name: 'write_todos', args: { todos: [[{ content: 'x' }]] }, id: 'arr1' }] }),
        new AIMessage('done'),
      ])
      const out = await app.invoke(
        {
          messages: [new HumanMessage('plan something')],
          steps: 0,
          planningMode: 'plan',
          planStatus: 'none',
        },
        { configurable: { ctx: { sessionId: 'test-session', runner, tools: buildTools(root), emit: noopEmit, summarizer: noopSummarizer } } },
      )
      expect(out.plan).toBeDefined()
      expect(out.plan!.length).toBeGreaterThan(0)
      expect(out.plan![0].content).not.toBe('undefined')
    })
  })

  it('todoToPlanItem: missing content in object todo becomes empty string', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const runner = fakeRunner([
        new AIMessage({ content: '', tool_calls: [{ name: 'write_todos', args: { todos: [{ status: 'pending' }] }, id: 'miss1' }] }),
        new AIMessage('done'),
      ])
      const out = await app.invoke(
        {
          messages: [new HumanMessage('plan something')],
          steps: 0,
          planningMode: 'plan',
          planStatus: 'none',
        },
        { configurable: { ctx: { sessionId: 'test-session', runner, tools: buildTools(root), emit: noopEmit, summarizer: noopSummarizer } } },
      )
      expect(out.plan).toBeDefined()
      expect(out.plan!.length).toBe(1)
      expect(out.plan![0].content).toBe('')
      expect(out.plan![0].status).toBe('pending')
    })
  })

  it('deriveUpdatedPlan: ignores write_todos with args as array, keeps original plan', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const originalPlan = [{ content: 'original plan', status: 'pending' as const }]
      const runner = fakeRunner([
        new AIMessage({ content: '', tool_calls: [{ name: 'write_todos', args: ['not-an-object'], id: 'bad1' }] }),
        new AIMessage('done'),
      ])
      const out = await app.invoke(
        {
          messages: [new HumanMessage('do work')],
          steps: 0,
          planningMode: 'plan',
          planStatus: 'approved',
          plan: originalPlan,
        },
        { configurable: { ctx: { sessionId: 'test-session', runner, tools: buildTools(root), emit: noopEmit, summarizer: noopSummarizer } }, recursionLimit: 30 },
      )
      expect(out.plan).toEqual(originalPlan)
    })
  })

  it('deriveUpdatedPlan: ignores non-write_todos tool calls, keeps original plan', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const originalPlan = [{ content: 'original plan', status: 'pending' as const }]
      const runner = fakeRunner([
        new AIMessage({ content: '', tool_calls: [{ name: 'ls', args: { path: '/' }, id: 'ls1' }] }),
        new AIMessage('done'),
      ])
      const out = await app.invoke(
        {
          messages: [new HumanMessage('do work')],
          steps: 0,
          planningMode: 'plan',
          planStatus: 'approved',
          plan: originalPlan,
        },
        { configurable: { ctx: { sessionId: 'test-session', runner, tools: buildTools(root), emit: noopEmit, summarizer: noopSummarizer } }, recursionLimit: 30 },
      )
      expect(out.plan).toEqual(originalPlan)
    })
  })
})

/** Two unknown tools → trailing error streak of 2 (replan threshold). */
function errBatch2(idPrefix: string): AIMsg {
  return new AIMessage({
    content: '',
    tool_calls: [
      { name: `ghost_${idPrefix}_a`, args: {}, id: `${idPrefix}-a` },
      { name: `ghost_${idPrefix}_b`, args: {}, id: `${idPrefix}-b` },
    ],
  })
}

/** Three unknown tools → trailing error streak of 3 (error-streak limit). */
function errBatch3(idPrefix: string): AIMsg {
  return new AIMessage({
    content: '',
    tool_calls: [
      { name: `ghost_${idPrefix}_a`, args: {}, id: `${idPrefix}-a` },
      { name: `ghost_${idPrefix}_b`, args: {}, id: `${idPrefix}-b` },
      { name: `ghost_${idPrefix}_c`, args: {}, id: `${idPrefix}-c` },
    ],
  })
}

function countReplanMessages(messages: BaseMessage[]): number {
  return messages.filter(
    (m) => m instanceof SystemMessage && typeof m.content === 'string' && m.content.includes('Replanning required'),
  ).length
}

function baseCtx(
  root: string,
  runner: ModelRunner,
  extra?: Partial<GraphCtx>,
): GraphCtx {
  return {
    sessionId: 'test-session',
    runner,
    tools: buildTools(root),
    emit: noopEmit,
    summarizer: noopSummarizer,
    ...extra,
  }
}

describe('replan × error-streak decision table (Track A)', () => {
  it('happy path: no tool errors does not inject replan or error-streak nudge', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const runner = fakeRunner([
        new AIMessage({ content: '', tool_calls: [{ name: 'ls', args: { path: '/' }, id: 'ok1' }] }),
        new AIMessage('all good'),
      ])
      const out = await app.invoke(
        { messages: [new HumanMessage('list')], steps: 0 },
        { configurable: { ctx: baseCtx(root, runner) }, recursionLimit: 30 },
      )
      expect(countReplanMessages(out.messages)).toBe(0)
      expect(out.messages.some((m) => m instanceof SystemMessage && m.content === ERROR_STREAK_NUDGE)).toBe(false)
      expect((out.messages[out.messages.length - 1] as AIMessage).content).toBe('all good')
      expect(out.status).toBe('running')
    })
  })

  it('≥2 tool errors → exactly one replan inject; guard blocks a second replan', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const guard = new TurnReplanGuard()
      // batch2 → replan → batch2 (no second replan, streak < 3) → done
      const runner = fakeRunner([errBatch2('r1'), errBatch2('r2'), new AIMessage('revised approach')])
      const out = await app.invoke(
        { messages: [new HumanMessage('fail twice')], steps: 0 },
        { configurable: { ctx: baseCtx(root, runner, { replanGuard: guard }) }, recursionLimit: 40 },
      )
      expect(countReplanMessages(out.messages)).toBe(1)
      expect(guard.hasReplanned).toBe(true)
      expect(out.messages.some((m) => m instanceof SystemMessage && m.content === ERROR_STREAK_NUDGE)).toBe(false)
      expect((out.messages[out.messages.length - 1] as AIMessage).content).toBe('revised approach')
    })
  })

  it('replan does not set error-streak nudgedSig; post-replan errors≥3 → nudge then pause', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const guard = new TurnReplanGuard()
      // replan (2 errs) → error-streak nudge (3 errs) → pause (3 errs again)
      const runner = fakeRunner([errBatch2('p1'), errBatch3('p2'), errBatch3('p3')])
      const out = await app.invoke(
        { messages: [new HumanMessage('keep failing')], steps: 0 },
        { configurable: { ctx: baseCtx(root, runner, { replanGuard: guard }) }, recursionLimit: 50 },
      )
      expect(countReplanMessages(out.messages)).toBe(1)
      expect(out.messages.some((m) => m instanceof SystemMessage && m.content === ERROR_STREAK_NUDGE)).toBe(true)
      expect(out.status).toBe('awaiting_user')
      expect(out.pendingQuestion).toBeTruthy()
      expect(out.nudgedSig).toBe('error-streak')
    })
  })

  it('subagent pause marker does not trigger replan or error-streak', async () => {
    await withTmp(async (root) => {
      const pauseTool = tool(
        async () => `${SUBAGENT_PAUSE_MARKER} Which API should we target?`,
        { name: 'pause_probe', description: 'returns pause marker', schema: z.object({}) },
      )
      const app = buildGraph()
      const runner = fakeRunner([
        new AIMessage({
          content: '',
          tool_calls: [
            { name: 'pause_probe', args: {}, id: 'pp1' },
            { name: 'pause_probe', args: {}, id: 'pp2' },
            { name: 'pause_probe', args: {}, id: 'pp3' },
          ],
        }),
        new AIMessage('handled pause'),
      ])
      const out = await app.invoke(
        { messages: [new HumanMessage('delegate')], steps: 0 },
        {
          configurable: {
            ctx: baseCtx(root, runner, { tools: [pauseTool] }),
          },
          recursionLimit: 30,
        },
      )
      expect(countReplanMessages(out.messages)).toBe(0)
      expect(out.messages.some((m) => m instanceof SystemMessage && m.content === ERROR_STREAK_NUDGE)).toBe(false)
      expect(out.status).toBe('running')
      expect((out.messages[out.messages.length - 1] as AIMessage).content).toBe('handled pause')
    })
  })

  it('plan-mode hasToolFailure ignores subagent pause marker', async () => {
    await withTmp(async (root) => {
      const pauseTool = tool(
        async () => `${SUBAGENT_PAUSE_MARKER} need input`,
        { name: 'pause_probe', description: 'pause', schema: z.object({}) },
      )
      const app = buildGraph()
      const runner = fakeRunner([
        new AIMessage({ content: '', tool_calls: [{ name: 'pause_probe', args: {}, id: 'pl1' }] }),
        new AIMessage('continue plan'),
      ])
      const out = await app.invoke(
        {
          messages: [new HumanMessage('planned work')],
          steps: 0,
          planningMode: 'plan',
          planStatus: 'approved',
          plan: [{ content: 'step one', status: 'pending' }],
        },
        {
          configurable: { ctx: baseCtx(root, runner, { tools: [pauseTool] }) },
          recursionLimit: 30,
        },
      )
      // Pause marker is not a tool failure; plan-mode must not pause.
      expect(out.status).toBe('running')
      expect((out.messages[out.messages.length - 1] as AIMessage).content).toBe('continue plan')
    })
  })

  it('plan-mode hasToolFailure still pauses on real Error tool results', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const runner = fakeRunner([
        new AIMessage({ content: '', tool_calls: [{ name: 'missing_tool', args: {}, id: 'err1' }] }),
      ])
      const out = await app.invoke(
        {
          messages: [new HumanMessage('planned work')],
          steps: 0,
          planningMode: 'plan',
          planStatus: 'approved',
          plan: [{ content: 'step one', status: 'pending' }],
        },
        { configurable: { ctx: baseCtx(root, runner) }, recursionLimit: 20 },
      )
      expect(out.status).toBe('awaiting_user')
      expect(out.pendingQuestion).toBeTruthy()
    })
  })

  it('doom sig repeat still nudges then pauses (priority over replan)', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const loop = () => new AIMessage({ content: '', tool_calls: [{ name: 'ls', args: { path: '/' }, id: 'x' }] })
      const out = await app.invoke(
        { messages: [new HumanMessage('doom')], steps: 0 },
        { configurable: { ctx: baseCtx(root, fakeRunner([loop(), loop(), loop(), loop()])) }, recursionLimit: 90 },
      )
      expect(out.status).toBe('awaiting_user')
      expect(countReplanMessages(out.messages)).toBe(0)
      expect(out.messages.some((m) => m instanceof SystemMessage && typeof m.content === 'string' && m.content.includes('重复'))).toBe(true)
    })
  })

  it('doom∩error-streak: same-sig multi-error batches latch doom nudgedSig and pause (not infinite nudge)', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const guard = new TurnReplanGuard()
      // Fixed name+args so sigOf matches across batches (ids may differ).
      const sameFail3 = (id: string) =>
        new AIMessage({
          content: '',
          tool_calls: [
            { name: 'ghost_a', args: { path: '/x' }, id: `${id}-a` },
            { name: 'ghost_b', args: { path: '/y' }, id: `${id}-b` },
            { name: 'ghost_c', args: { path: '/z' }, id: `${id}-c` },
          ],
        })
      const expectedSig = sigOf([
        { name: 'ghost_a', args: { path: '/x' } },
        { name: 'ghost_b', args: { path: '/y' } },
        { name: 'ghost_c', args: { path: '/z' } },
      ])
      // Ladder: replan (batch1) → error-streak nudge (batch2, sigs=2) →
      // doom nudge (batch3, sigs=3, must stamp lastSig not error-streak) →
      // doom pause (batch4). Without doom-first nudge, this loops forever.
      const runner = fakeRunner([
        sameFail3('1'),
        sameFail3('2'),
        sameFail3('3'),
        sameFail3('4'),
        sameFail3('5'), // must not be needed if pause works
      ])
      const out = await app.invoke(
        { messages: [new HumanMessage('same fail forever')], steps: 0 },
        { configurable: { ctx: baseCtx(root, runner, { replanGuard: guard }) }, recursionLimit: 40 },
      )
      expect(countReplanMessages(out.messages)).toBe(1)
      expect(out.status).toBe('awaiting_user')
      expect(out.pendingQuestion).toBeTruthy()
      // Doom latch, not stuck on error-streak (the bug: infinite doom→nudge).
      expect(out.nudgedSig).toBe(expectedSig)
      expect(out.messages.some((m) => m instanceof SystemMessage && m.content === DOOM_LOOP_NUDGE)).toBe(true)
      // Bounded: should pause within a few steps, not thrash to recursion limit.
      expect(out.steps).toBeLessThanOrEqual(5)
    })
  })

  it('creates TurnReplanGuard on GraphCtx when missing', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const ctx = baseCtx(root, fakeRunner([errBatch2('g1'), new AIMessage('after replan')]))
      expect(ctx.replanGuard).toBeUndefined()
      await app.invoke(
        { messages: [new HumanMessage('auto guard')], steps: 0 },
        { configurable: { ctx }, recursionLimit: 30 },
      )
      expect(ctx.replanGuard).toBeInstanceOf(TurnReplanGuard)
      expect(ctx.replanGuard!.hasReplanned).toBe(true)
    })
  })
})

describe('loopSignal emissions (Track E1)', () => {
  function collectingEmit(): { emit: GraphEmit; events: LoopEvent[] } {
    const events: LoopEvent[] = []
    return {
      events,
      emit: {
        ...noopEmit,
        loopSignal: (e) => {
          events.push(e)
        },
      },
    }
  }

  it('default-preserving: undefined loopSignal does not throw on nudge/pause', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const loop = () => new AIMessage({ content: '', tool_calls: [{ name: 'ls', args: { path: '/' }, id: 'x' }] })
      const out = await app.invoke(
        { messages: [new HumanMessage('doom')], steps: 0 },
        {
          configurable: {
            ctx: baseCtx(root, fakeRunner([loop(), loop(), loop(), loop()]), {
              emit: noopEmit, // no loopSignal
            }),
          },
          recursionLimit: 90,
        },
      )
      expect(out.status).toBe('awaiting_user')
      expect(noopEmit.loopSignal).toBeUndefined()
    })
  })

  it('emits loop.nudge (doom) then loop.pause (kind=doom) on repeated identical tool calls', async () => {
    await withTmp(async (root) => {
      const { emit, events } = collectingEmit()
      const app = buildGraph()
      const loop = () => new AIMessage({ content: '', tool_calls: [{ name: 'ls', args: { path: '/' }, id: 'x' }] })
      const out = await app.invoke(
        { messages: [new HumanMessage('doom')], steps: 0 },
        {
          configurable: {
            ctx: baseCtx(root, fakeRunner([loop(), loop(), loop(), loop()]), {
              emit,
              turnId: 'turn-doom',
            }),
          },
          recursionLimit: 90,
        },
      )
      expect(out.status).toBe('awaiting_user')
      const types = events.map((e) => e.type)
      expect(types).toContain('loop.nudge')
      expect(types).toContain('loop.pause')
      const nudge = events.find((e) => e.type === 'loop.nudge')
      expect(nudge).toMatchObject({
        type: 'loop.nudge',
        sessionId: 'test-session',
        turnId: 'turn-doom',
        reason: 'doom',
      })
      const pause = events.find((e) => e.type === 'loop.pause')
      expect(pause).toMatchObject({
        type: 'loop.pause',
        sessionId: 'test-session',
        turnId: 'turn-doom',
        kind: 'doom',
      })
      // Pause path ends via pause node — no loop.end on awaiting_user
      expect(events.some((e) => e.type === 'loop.end')).toBe(false)
    })
  })

  it('emits loop.replan then loop.nudge (error_streak) then loop.pause on error ladder', async () => {
    await withTmp(async (root) => {
      const { emit, events } = collectingEmit()
      const app = buildGraph()
      const guard = new TurnReplanGuard()
      // replan (2 errs) → error-streak nudge (3 errs) → pause
      const runner = fakeRunner([errBatch2('p1'), errBatch3('p2'), errBatch3('p3')])
      const out = await app.invoke(
        { messages: [new HumanMessage('keep failing')], steps: 0 },
        {
          configurable: {
            ctx: baseCtx(root, runner, { replanGuard: guard, emit, turnId: 'turn-replan' }),
          },
          recursionLimit: 50,
        },
      )
      expect(out.status).toBe('awaiting_user')
      const types = events.map((e) => e.type)
      expect(types).toContain('loop.replan')
      expect(types).toContain('loop.nudge')
      expect(types).toContain('loop.pause')
      const replan = events.find((e) => e.type === 'loop.replan')
      expect(replan).toMatchObject({
        type: 'loop.replan',
        sessionId: 'test-session',
        turnId: 'turn-replan',
      })
      expect(replan && replan.type === 'loop.replan' && replan.reason.length).toBeGreaterThan(0)
      const nudge = events.find((e) => e.type === 'loop.nudge')
      expect(nudge).toMatchObject({ type: 'loop.nudge', reason: 'error_streak' })
    })
  })

  it('emits loop.pause kind=plan on planPause', async () => {
    await withTmp(async (root) => {
      const { emit, events } = collectingEmit()
      const app = buildGraph()
      const runner = fakeRunner([
        new AIMessage({ content: '', tool_calls: [{ name: 'ls', args: { path: '/' }, id: 'c1' }] }),
      ])
      const out = await app.invoke(
        {
          messages: [new HumanMessage('plan ready')],
          steps: 0,
          planStatus: 'ready',
          planningMode: 'plan',
          plan: [{ content: 'do thing', status: 'pending' }],
        },
        {
          configurable: {
            ctx: baseCtx(root, runner, { emit, turnId: 'turn-plan' }),
          },
          recursionLimit: 20,
        },
      )
      expect(out.status).toBe('awaiting_user')
      const pause = events.find((e) => e.type === 'loop.pause')
      expect(pause).toMatchObject({
        type: 'loop.pause',
        kind: 'plan',
        turnId: 'turn-plan',
      })
      expect(events.some((e) => e.type === 'loop.end')).toBe(false)
    })
  })

  it('emits loop.end reason=completed when model returns plain text', async () => {
    await withTmp(async (root) => {
      const { emit, events } = collectingEmit()
      const app = buildGraph()
      await app.invoke(
        { messages: [new HumanMessage('hi')], steps: 0 },
        {
          configurable: {
            ctx: baseCtx(root, fakeRunner([new AIMessage('done')]), {
              emit,
              turnId: 'turn-end',
            }),
          },
        },
      )
      expect(events).toEqual([
        {
          type: 'loop.end',
          sessionId: 'test-session',
          turnId: 'turn-end',
          reason: 'completed',
        },
      ])
    })
  })

  it('sink throw does not break the agent loop (emitLoopSignal best-effort)', async () => {
    await withTmp(async (root) => {
      const app = buildGraph()
      const emit: GraphEmit = {
        ...noopEmit,
        loopSignal: () => {
          throw new Error('sink blew up')
        },
      }
      const out = await app.invoke(
        { messages: [new HumanMessage('hi')], steps: 0 },
        {
          configurable: {
            ctx: baseCtx(root, fakeRunner([new AIMessage('ok')]), { emit }),
          },
        },
      )
      expect((out.messages[out.messages.length - 1] as AIMessage).content).toBe('ok')
    })
  })
})
