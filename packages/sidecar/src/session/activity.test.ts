import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import { Session } from './session.js'
import { setActiveModel } from '../config/providers.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import type { HookContext, HookResult } from '@hip/protocol'

function fakeRunner(script: AIMessage[]): ModelRunner {
  let i = 0
  return {
    async run(_messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
      const m = script[Math.min(i, script.length - 1)]
      i++
      if (typeof m.content === 'string' && m.content) opts.onText(m.content)
      // Return a fresh message so LangGraph cannot mutate the shared prototype.
      return new AIMessage({
        content: m.content,
        tool_calls: m.tool_calls?.map((tc) => ({ ...tc, type: 'tool_call' as const })),
      })
    },
  }
}

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'hip-activity-'))
}

function cleanupTmp(root: string): void {
  rmSync(root, { recursive: true, force: true })
}

beforeAll(() => {
  setActiveModel({ providerID: 'openai', modelID: 'gpt-4', baseURL: '' })
})

describe('Activity boundary', () => {
  it('startActivity returns an activity and currentActivity exposes it', () => {
    const session = new Session('t-act-start', { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] })
    const activity = session.startActivity('test goal')
    expect(activity.description).toBe('test goal')
    // Default from [agentLoop].maxSteps (or MAX_STEPS = 800 when unset).
    expect(activity.totalStepsAllowed).toBe(800)
    expect(activity.stepsRemaining).toBe(800)
    expect(session.currentActivity()?.id).toBe(activity.id)
  })

  it('runTurn consumes stepsRemaining and stops at zero', async () => {
    const root = makeTmp()
    try {
      const loopMsg = new AIMessage({
        content: '',
        tool_calls: [{ name: 'ls', args: { path: root }, id: 'loop-ls' }],
      })
      const runner = fakeRunner([loopMsg, loopMsg, loopMsg, loopMsg])
      const session = new Session(
        't-act-consume',
        { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [], cwd: root },
        undefined,
        undefined,
        undefined,
        10_000,
        runner,
      )
      const activity = session.startActivity('spin', 3)
      session.enqueueInput({ type: 'steer', content: 'spin' })
      await session.drainInputQueue(() => {})
      expect(activity.stepsRemaining).toBe(0)
    } finally {
      cleanupTmp(root)
    }
  })

  it('extendActivity with hook approval increases steps', async () => {
    const session = new Session('t-act-extend', { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] })
    const activity = session.startActivity('extend', 3)
    session.registerHook({
      event: 'ActivityBudgetRequest',
      handler: async (_ctx: HookContext): Promise<HookResult> => ({ kind: 'allow', steps: 5 }),
    })
    const ok = await session.extendActivity(5)
    expect(ok).toBe(true)
    expect(activity.stepsRemaining).toBe(8)
  })

  it('extendActivity with hook denial leaves steps unchanged', async () => {
    const session = new Session('t-act-deny', { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] })
    const activity = session.startActivity('deny', 3)
    session.registerHook({
      event: 'ActivityBudgetRequest',
      handler: async (_ctx: HookContext): Promise<HookResult> => ({ kind: 'deny', reason: 'budget capped' }),
    })
    const ok = await session.extendActivity(2)
    expect(ok).toBe(false)
    expect(activity.stepsRemaining).toBe(3)
  })

  it('new user message auto-starts an activity', async () => {
    const runner = fakeRunner([new AIMessage('hello there')])
    const session = new Session(
      't-act-auto',
      { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] },
      undefined,
      undefined,
      undefined,
      10_000,
      runner,
    )
    await session.sendMessage('hello', () => {})
    expect(session.currentActivity()?.description).toBe('hello')
  })

  it('ActivityStart and ActivityEnd hooks fire', async () => {
    const events: string[] = []
    const session = new Session('t-act-hooks', { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] })
    session.registerHook({
      event: 'ActivityStart',
      handler: async (ctx: HookContext): Promise<HookResult> => {
        events.push(`start:${ctx.activityId}`)
        return { kind: 'allow' }
      },
    })
    session.registerHook({
      event: 'ActivityEnd',
      handler: async (ctx: HookContext): Promise<HookResult> => {
        events.push(`end:${ctx.activityId}`)
        return { kind: 'allow' }
      },
    })
    const activity = session.startActivity('hooks')
    session.endActivity()
    expect(events).toEqual([`start:${activity.id}`, `end:${activity.id}`])
  })
})
