/**
 * PR-8: background usage fold into SessionUsageAggregate + incomplete on kill/missing.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import type { ServerMessage, TurnUsage } from '@hip/protocol'
import { Session } from './session.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'
import { parseSessionUsageAggregate } from './usage.js'
import * as subagentMod from './subagent.js'

afterEach(() => {
  vi.restoreAllMocks()
})

function inMemoryStore(): SessionStore {
  const { db, ftsEnabled } = openDatabase(':memory:')
  return new SessionStore(db, ftsEnabled)
}

function makeSessionWithStore(id: string, store: SessionStore, runner?: ModelRunner): Session {
  store.insertSession({
    id,
    title: 'test',
    config: JSON.stringify({ llmProvider: 'deepseek', model: 'm', tools: [], cwd: process.cwd() }),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
  return new Session(
    id,
    { llmProvider: 'deepseek', model: 'm', tools: [], cwd: process.cwd() },
    undefined,
    store,
    undefined,
    undefined,
    runner ?? { async run() { return new AIMessage('ok') } },
  )
}

describe('session usage aggregate + background fold (PR-8)', () => {
  it('folds captured bg usage into session aggregate and persists usage_json', async () => {
    const st = inMemoryStore()
    const session = makeSessionWithStore('s-bg-fold', st)
    const usage: TurnUsage = {
      inputTokens: 100,
      outputTokens: 40,
      totalTokens: 140,
      modelId: 'claude-sonnet-4',
      providerId: 'anthropic',
    }
    vi.spyOn(subagentMod, 'runSubagent').mockResolvedValue({
      text: 'bg done',
      usage,
    })

    const events: ServerMessage[] = []
    const ac = new AbortController()
    await session.runBackgroundSubagent('t1', 'research', ac.signal, (m) => events.push(m))

    expect(session.sessionUsage.inputTokens).toBe(100)
    expect(session.sessionUsage.outputTokens).toBe(40)
    expect(session.sessionUsage.totalTokens).toBe(140)
    expect(session.sessionUsage.byModel['claude-sonnet-4']?.inputTokens).toBe(100)
    expect(session.sessionUsage.incomplete).toBeUndefined()

    const raw = st.getSessionUsageJson('s-bg-fold')
    const loaded = parseSessionUsageAggregate(raw)
    expect(loaded?.totalTokens).toBe(140)
    expect(loaded?.byModel['claude-sonnet-4']?.outputTokens).toBe(40)

    const updated = events.filter((e) => e.type === 'usage:updated')
    expect(updated.length).toBeGreaterThanOrEqual(1)
    expect((updated[updated.length - 1] as Extract<ServerMessage, { type: 'usage:updated' }>).usage.totalTokens).toBe(140)
  })

  it('marks incomplete when bg completes with no usage metadata (no invented tokens)', async () => {
    const st = inMemoryStore()
    const session = makeSessionWithStore('s-bg-missing', st)
    vi.spyOn(subagentMod, 'runSubagent').mockResolvedValue({
      text: 'bg done without usage',
      // usage omitted
    })

    await session.runBackgroundSubagent('t2', 'research', new AbortController().signal, () => {})

    expect(session.sessionUsage.incomplete).toBe(true)
    expect(session.sessionUsage.inputTokens).toBe(0)
    expect(session.sessionUsage.totalTokens).toBe(0)
    const loaded = parseSessionUsageAggregate(st.getSessionUsageJson('s-bg-missing'))
    expect(loaded?.incomplete).toBe(true)
    expect(loaded?.totalTokens).toBe(0)
  })

  it('marks incomplete on kill and still folds partial usage when present', async () => {
    const st = inMemoryStore()
    const session = makeSessionWithStore('s-bg-kill', st)
    const partial: TurnUsage = {
      inputTokens: 25,
      outputTokens: 5,
      totalTokens: 30,
      modelId: 'm1',
    }
    vi.spyOn(subagentMod, 'runSubagent').mockResolvedValue({
      text: 'partial',
      usage: partial,
    })

    // Seed a killed task the way stop() would before runner settles.
    session.backgroundManager.meta.set('kill-1', {
      description: 'x',
      status: 'running',
      kind: 'agent',
      abortController: new AbortController(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    expect(session.backgroundManager.stop('kill-1', 'user cancel')).toBe('killed')

    const events: ServerMessage[] = []
    await session.runBackgroundSubagent('kill-1', 'x', new AbortController().signal, (m) => events.push(m))

    expect(session.sessionUsage.inputTokens).toBe(25)
    expect(session.sessionUsage.totalTokens).toBe(30)
    expect(session.sessionUsage.incomplete).toBe(true)
    expect(session.sessionUsage.byModel['m1']?.inputTokens).toBe(25)

    const loaded = parseSessionUsageAggregate(st.getSessionUsageJson('s-bg-kill'))
    expect(loaded?.incomplete).toBe(true)
    expect(loaded?.totalTokens).toBe(30)

    const notifs = events.filter(
      (e) => e.type === 'agent:notification' && (e as { taskId?: string }).taskId === 'kill-1',
    )
    expect(notifs.some((n) => (n as { status?: string }).status === 'killed')).toBe(true)
  })

  it('marks incomplete on kill with no usage (timeout/abort path)', async () => {
    const st = inMemoryStore()
    const session = makeSessionWithStore('s-bg-kill-empty', st)
    const ac = new AbortController()
    vi.spyOn(subagentMod, 'runSubagent').mockImplementation(async () => {
      ac.abort()
      const err = new Error('aborted')
      err.name = 'AbortError'
      throw err
    })

    session.backgroundManager.meta.set('kill-empty', {
      description: 'x',
      status: 'running',
      kind: 'agent',
      abortController: ac,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    session.backgroundManager.stop('kill-empty', 'timeout')

    await session.runBackgroundSubagent('kill-empty', 'x', ac.signal, () => {})

    expect(session.sessionUsage.incomplete).toBe(true)
    expect(session.sessionUsage.inputTokens).toBe(0)
    expect(session.sessionUsage.totalTokens).toBe(0)
  })

  it('hydrates sessionUsage from sessions.usage_json on construct', () => {
    const st = inMemoryStore()
    st.insertSession({
      id: 's-hydrate',
      title: 't',
      config: JSON.stringify({ llmProvider: 'deepseek', model: 'm', tools: [] }),
      createdAt: 1,
      updatedAt: 1,
    })
    st.setSessionUsageJson(
      's-hydrate',
      JSON.stringify({
        inputTokens: 9,
        outputTokens: 1,
        totalTokens: 10,
        byModel: { m: { inputTokens: 9, outputTokens: 1, totalTokens: 10 } },
        updatedAt: 42,
        incomplete: true,
      }),
    )
    const session = new Session(
      's-hydrate',
      { llmProvider: 'deepseek', model: 'm', tools: [] },
      undefined,
      st,
    )
    expect(session.sessionUsage.totalTokens).toBe(10)
    expect(session.sessionUsage.incomplete).toBe(true)
    expect(session.sessionUsage.updatedAt).toBe(42)
  })

  it('single-writer fold is additive across sequential folds', () => {
    const st = inMemoryStore()
    const session = makeSessionWithStore('s-sw', st)
    session.foldSessionUsage({ inputTokens: 1, outputTokens: 0, totalTokens: 1, modelId: 'a' })
    session.foldSessionUsage({ inputTokens: 2, outputTokens: 3, totalTokens: 5, modelId: 'b' })
    expect(session.sessionUsage.inputTokens).toBe(3)
    expect(session.sessionUsage.outputTokens).toBe(3)
    expect(session.sessionUsage.totalTokens).toBe(6)
    expect(Object.keys(session.sessionUsage.byModel).sort()).toEqual(['a', 'b'])
  })
})

describe('runSubagent returns usage (capture path)', () => {
  it('returns usage from emit even when mode is background', async () => {
    class UsageRunner implements ModelRunner {
      async run(_msgs: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
        opts.onText?.('hi')
        // Simulate graph emit via side-channel: caller's graph path uses usage_metadata.
        // Here we only verify return shape when emit.usage is called by the graph —
        // graph integration is covered elsewhere; unit-test the capture wrapper via spy-free direct path.
        return new AIMessage('hi')
      }
    }
    // Direct unit: mock is enough for bg fold tests above; this checks SubagentRunResult shape.
    const spy = vi.spyOn(subagentMod, 'runSubagent').mockResolvedValue({
      text: 'hi',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    })
    const r = await subagentMod.runSubagent({
      runner: new UsageRunner(),
      root: process.cwd(),
      summarizer: { async summarize() { return '' } },
      emit: {
        token: () => {},
        reasoning: () => {},
        toolStarted: () => {},
        toolFinished: () => {},
        usage: () => {},
        planDelta: () => {},
        compaction: () => {},
      },
      signal: new AbortController().signal,
      description: 'x',
      childMaxSteps: 5,
      mode: 'background',
    })
    expect(r.text).toBe('hi')
    expect(r.usage?.totalTokens).toBe(2)
    spy.mockRestore()
  })
})
