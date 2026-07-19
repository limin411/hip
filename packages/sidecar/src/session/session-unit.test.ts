import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import type { ChatGenerationChunk } from '@langchain/core/outputs'
import { Session, resolveModel, tryAutoResolvePermission } from './session.js'
import { setActiveModel, DEEPSEEK_DEFAULT } from '../config/providers.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'

type Ev = { type: string; [k: string]: unknown }

/** A model whose stream HANGS — it never yields a chunk and only settles (rejecting with an
 *  AbortError) once the turn's abort signal fires. Simulates a half-open provider stream so the
 *  idle watchdog is the only thing that can end the turn. `bindTools` keeps `this` because
 *  FakeListChatModel.bindTools builds a fresh *base* instance, which would drop these overrides. */
class HangingChatModel extends FakeListChatModel {
  constructor() {
    super({ responses: ['unreached'] })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bindTools(): any {
    return this
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async _generate(_messages: BaseMessage[], options: any): Promise<any> {
    return hang(options?.signal)
  }
  async *_streamResponseChunks(
    _messages: BaseMessage[],
    options: this['ParsedCallOptions'],
  ): AsyncGenerator<ChatGenerationChunk> {
    await hang(options.signal)
    // Unreachable: hang() only ever rejects.
    yield undefined as unknown as ChatGenerationChunk
  }
}

/** Never resolves; rejects with an AbortError when the signal fires (or is already aborted). */
function hang(signal?: AbortSignal): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    const fail = () => {
      const e = new Error('Aborted')
      e.name = 'AbortError'
      reject(e)
    }
    if (signal?.aborted) return fail()
    signal?.addEventListener('abort', fail, { once: true })
  })
}

function collect(session: Session, text: string): Promise<Ev[]> {
  const events: Ev[] = []
  return session.sendMessage(text, (m) => events.push(m as Ev)).then(() => events)
}

describe('resolveModel', () => {
  it('returns deepseek-reasoner when model is empty and thinking is true', () => {
    expect(resolveModel({ llmProvider: 'deepseek', model: '', tools: [], thinking: true })).toBe('deepseek-reasoner')
  })

  it('returns deepseek-chat when model is empty and thinking is false', () => {
    expect(resolveModel({ llmProvider: 'deepseek', model: '', tools: [], thinking: false })).toBe('deepseek-chat')
  })

  it('returns deepseek-reasoner when model is empty and thinking is undefined (defaults to reasoner)', () => {
    expect(resolveModel({ llmProvider: 'deepseek', model: '', tools: [] })).toBe('deepseek-reasoner')
  })

  it('returns the explicit model when model is set, even if thinking is true', () => {
    expect(resolveModel({ llmProvider: 'deepseek', model: 'deepseek-chat', tools: [], thinking: true })).toBe('deepseek-chat')
  })
})

describe('Session.setThinking', () => {
  it('returns true and updates config when session is idle', () => {
    const model = new FakeListChatModel({ responses: ['ok'] })
    const session = new Session('t-thinking-idle', { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [], thinking: true }, model)
    const applied = session.setThinking(false)
    expect(applied).toBe(true)
    expect(session.config.thinking).toBe(false)
  })

  it('returns false and leaves config unchanged when a turn is running', () => {
    const model = new FakeListChatModel({ responses: ['ok'] })
    const session = new Session('t-thinking-running', { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [], thinking: true }, model)
    // Simulate a running turn by setting the private field via type cast.
    ;(session as unknown as { running: boolean }).running = true
    const applied = session.setThinking(false)
    expect(applied).toBe(false)
    expect(session.config.thinking).toBe(true)
  })
})

describe('Session.setSystemPrompt', () => {
  it('returns true and updates config when idle', () => {
    const model = new FakeListChatModel({ responses: ['ok'] })
    const session = new Session('t-sp-idle', { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] }, model)
    expect(session.setSystemPrompt('Be terse')).toBe(true)
    expect(session.config.systemPrompt).toBe('Be terse')
  })
  it('normalizes blank instructions to undefined', () => {
    const model = new FakeListChatModel({ responses: ['ok'] })
    const session = new Session('t-sp-blank', { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [], systemPrompt: 'old' }, model)
    expect(session.setSystemPrompt('   ')).toBe(true)
    expect(session.config.systemPrompt).toBeUndefined()
  })
  it('clears on null', () => {
    const model = new FakeListChatModel({ responses: ['ok'] })
    const session = new Session('t-sp-null', { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [], systemPrompt: 'old' }, model)
    expect(session.setSystemPrompt(null)).toBe(true)
    expect(session.config.systemPrompt).toBeUndefined()
  })
  it('returns false and leaves config unchanged while a turn is running', () => {
    const model = new FakeListChatModel({ responses: ['ok'] })
    const session = new Session('t-sp-running', { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [], systemPrompt: 'keep' }, model)
    ;(session as unknown as { running: boolean }).running = true
    expect(session.setSystemPrompt('new')).toBe(false)
    expect(session.config.systemPrompt).toBe('keep')
  })
})

describe('Session.setPermissionMode', () => {
  it('returns true and updates config when idle', () => {
    const model = new FakeListChatModel({ responses: ['ok'] })
    const session = new Session('t-pm-idle', { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] }, model)
    expect(session.setPermissionMode('full')).toBe(true)
    expect(session.config.permissionMode).toBe('full')
  })
  it('can set chat mode', () => {
    const model = new FakeListChatModel({ responses: ['ok'] })
    const session = new Session('t-pm-chat', { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] }, model)
    expect(session.setPermissionMode('chat')).toBe(true)
    expect(session.config.permissionMode).toBe('chat')
  })
  it('returns false and leaves config unchanged while a turn is running', () => {
    const model = new FakeListChatModel({ responses: ['ok'] })
    const session = new Session('t-pm-running', { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [], permissionMode: 'edit' }, model)
    ;(session as unknown as { running: boolean }).running = true
    expect(session.setPermissionMode('full')).toBe(false)
    expect(session.config.permissionMode).toBe('edit')
  })
})

describe('Session message:complete agentRuns', () => {
  it('message:complete carries per-turn agentRuns stamped with messageId', async () => {
    const model = new FakeListChatModel({ responses: ['hello world'] })
    const session = new Session('t-agent-runs', { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] }, model)
    const events = await collect(session, 'hi')
    const complete = events.find((e) => e.type === 'message:complete') as { type: 'message:complete'; message: { id: string; agentRuns?: Array<{ messageId?: string }> } } | undefined
    expect(complete).toBeDefined()
    expect(complete!.message.agentRuns?.length).toBeGreaterThan(0)
    for (const r of complete!.message.agentRuns!) expect(r.messageId).toBe(complete!.message.id)
  })
})

describe('Session NO_API_KEY guard', () => {
  let saved: string | undefined
  beforeEach(() => { saved = process.env.HIP_MODEL_DEEPSEEK_API_KEY; delete process.env.HIP_MODEL_DEEPSEEK_API_KEY })
  afterEach(() => { if (saved !== undefined) process.env.HIP_MODEL_DEEPSEEK_API_KEY = saved })

  it('emits NO_API_KEY and no agent:started when key is absent and no model is injected', async () => {
    const session = new Session('t-nokey', { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] })
    const events = await collect(session, 'hi')
    expect(events.some((e) => e.type === 'agent:started')).toBe(false)
    const err = events.find((e) => e.type === 'error')
    expect(err).toBeDefined()
    expect((err as Ev).code).toBe('NO_API_KEY')
  })

  it('runs normally when a model is injected (guard skipped)', async () => {
    const model = new FakeListChatModel({ responses: ['hello world'] })
    const session = new Session('t-fake', { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] }, model)
    const events = await collect(session, 'hi')
    expect(events[0]?.type).toBe('agent:started')
    expect(events.some((e) => e.type === 'message:complete')).toBe(true)
  })
})

  describe('Session incompatible-model guard', () => {
  // The active model is a process-global; a stale/hand-edited hip.toml can point it at a
  // native-only provider. Restore the default after each case so other suites see deepseek.
  let savedKey: string | undefined
  beforeEach(() => { savedKey = process.env.HIP_MODEL_GOOGLE_API_KEY; delete process.env.HIP_MODEL_GOOGLE_API_KEY })
  afterEach(() => {
    setActiveModel(DEEPSEEK_DEFAULT)
    if (savedKey !== undefined) process.env.HIP_MODEL_GOOGLE_API_KEY = savedKey
  })

  it('emits INCOMPATIBLE_MODEL (not NO_API_KEY) and no agent:started for a native-only active provider', async () => {
    // No google key is set, so the compat guard must fire BEFORE requireApiKey — proving ordering.
    setActiveModel({ providerID: 'google', modelID: 'gemini-2.0-flash', baseURL: 'https://generativelanguage.googleapis.com' })
    const session = new Session('t-incompat', { llmProvider: 'google', model: 'gemini-2.0-flash', tools: [] })
    const events = await collect(session, 'hi')
    expect(events.some((e) => e.type === 'agent:started')).toBe(false)
    const err = events.find((e) => e.type === 'error')
    expect(err).toBeDefined()
    expect((err as Ev).code).toBe('INCOMPATIBLE_MODEL')
  })

  it('runs normally for an incompatible provider when a model is injected (guard skipped in tests)', async () => {
    setActiveModel({ providerID: 'google', modelID: 'gemini-2.0-flash', baseURL: 'https://generativelanguage.googleapis.com' })
    const model = new FakeListChatModel({ responses: ['hello world'] })
    const session = new Session('t-incompat-injected', { llmProvider: 'google', model: 'gemini-2.0-flash', tools: [] }, model)
    const events = await collect(session, 'hi')
    expect(events[0]?.type).toBe('agent:started')
    expect(events.some((e) => e.type === 'message:complete')).toBe(true)
  })
})

describe('Session idle-timeout watchdog', () => {
  it('aborts a stalled turn after the idle timeout and emits a TIMEOUT error', async () => {
    const sent: Ev[] = []
    // idleTimeoutMs = 20; the model's stream hangs until the watchdog aborts the turn.
    const session = new Session('t-stall', { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] }, new HangingChatModel(), undefined, undefined, 20)
    await session.sendMessage('hi', (m) => sent.push(m as Ev))
    const timeout = sent.find((m) => m.type === 'error' && (m as Ev).code === 'TIMEOUT') as Ev | undefined
    expect(timeout).toBeDefined()
    expect(String((timeout as { message?: string })?.message ?? '')).toMatch(/Idle timeout/i)
  })

  it('does not emit a TIMEOUT error for a normal fast turn', async () => {
    const sent: Ev[] = []
    // Normal fast turn with a generous idleTimeoutMs — completes well before the watchdog fires.
    const model = new FakeListChatModel({ responses: ['hello world'] })
    const session = new Session('t-fast', { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] }, model, undefined, undefined, 10_000)
    await session.sendMessage('hi', (m) => sent.push(m as Ev))
    expect(sent.some((m) => m.type === 'error' && (m as Ev).code === 'TIMEOUT')).toBe(false)
    expect(sent.some((m) => m.type === 'message:complete')).toBe(true)
  })

  it('does not TIMEOUT when tool-call stream activity pulses past the idle window', async () => {
    // Simulates large write_file arg streaming: no text for a while, only onActivity kicks.
    const idleMs = 40
    const runner: ModelRunner = {
      async run(_m: BaseMessage[], opts: ModelRunOptions) {
        for (let i = 0; i < 6; i++) {
          opts.onActivity?.()
          await new Promise((r) => setTimeout(r, 20))
        }
        opts.onText('done')
        return new AIMessage('done')
      },
    }
    const session = new Session(
      't-tool-activity',
      { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] },
      undefined,
      undefined,
      undefined,
      idleMs,
      runner,
    )
    const events = await collect(session, 'rewrite svg')
    expect(events.some((e) => e.type === 'error' && e.code === 'TIMEOUT')).toBe(false)
    expect(events.some((e) => e.type === 'message:complete')).toBe(true)
  })
})

describe('tryAutoResolvePermission lock table (chat/edit/full × tool kinds)', () => {
  // Behavior lock only — do NOT change full-mode to yolo. full always returns null (HITL path).
  // SAFE_KINDS = read | fetch | other → auto-allow in chat/edit when an allow* option exists.
  const opts = [
    { optionId: 'allow_once', name: 'Allow', kind: 'allow_once' },
    { optionId: 'reject_once', name: 'Reject', kind: 'reject_once' },
  ]
  const allow = { optionId: 'allow_once' }
  const hitl = null

  const modes = ['chat', 'edit', 'full'] as const
  const kinds = ['read', 'fetch', 'other', 'write', 'execute', 'edit'] as const

  /** Expected outcome: non-null = auto optionId, null = HITL (tryAutoResolve returns null). */
  const expected: Record<(typeof modes)[number], Record<(typeof kinds)[number], typeof allow | null>> = {
    chat: { read: allow, fetch: allow, other: allow, write: hitl, execute: hitl, edit: hitl },
    edit: { read: allow, fetch: allow, other: allow, write: hitl, execute: hitl, edit: hitl },
    // full: always null — upstream/HITL owns full-mode decisions; not yolo here.
    full: { read: hitl, fetch: hitl, other: hitl, write: hitl, execute: hitl, edit: hitl },
  }

  it.each(
    modes.flatMap((mode) => kinds.map((kind) => ({ mode, kind, want: expected[mode][kind] }))),
  )('$mode × $kind → $want', ({ mode, kind, want }) => {
    expect(tryAutoResolvePermission(mode, kind, opts)).toEqual(want)
  })
})
