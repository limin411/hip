import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import type { GraphEmit, GraphCtx } from './graph.js'
import { runManagedAgent } from './internal-runner.js'
import { NetworkPolicy } from './network-policy.js'
import { ToolOutputStore } from './tool-output-store.js'
import { GuardianReviewer } from './guardian.js'

// ── Safety-dep wiring test harness (vi.mock calls are hoisted by vitest) ───
const { capturedBuildToolsOpts, capturedGraphCtxs } = vi.hoisted(() => ({
  capturedBuildToolsOpts: [] as Array<Record<string, unknown> | undefined>,
  capturedGraphCtxs: [] as Array<GraphCtx>,
}))

vi.mock('./tools.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tools.js')>()
  const origBuildTools = actual.buildTools
  return {
    ...actual,
    buildTools: (root: string, spawnSubagent?: unknown, cwd?: string, dispatch?: unknown, opts?: Record<string, unknown>) => {
      capturedBuildToolsOpts.push(opts)
      return origBuildTools(root, spawnSubagent as Parameters<typeof origBuildTools>[1], cwd, dispatch as Parameters<typeof origBuildTools>[3], opts as Parameters<typeof origBuildTools>[4])
    },
  }
})

vi.mock('./graph.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./graph.js')>()
  const origBuildGraph = actual.buildGraph
  return {
    ...actual,
    buildGraph: (maxSteps?: number, compactBudget?: number) => {
      const g = origBuildGraph(maxSteps, compactBudget)
      const origInvoke: typeof g.invoke = g.invoke.bind(g)
      g.invoke = (state, options) => {
        const ctx = (options as { configurable?: { ctx?: GraphCtx } }).configurable?.ctx
        if (ctx) capturedGraphCtxs.push(ctx)
        return origInvoke(state, options)
      }
      return g
    },
  }
})

const dirs: string[] = []
function tmp() { const d = mkdtempSync(join(tmpdir(), 'hip-internal-')); dirs.push(d); return d }
afterEach(() => { while (dirs.length) { try { rmSync(dirs.pop()!, { recursive: true, force: true }) } catch { /* ignore */ } } })
beforeEach(() => {
  capturedBuildToolsOpts.length = 0
  capturedGraphCtxs.length = 0
})

function collectingEmit() {
  const tokens: string[] = []
  const emit: GraphEmit = { token: (d) => tokens.push(d), reasoning: () => {}, toolStarted: () => {}, toolFinished: () => {}, usage: () => {}, planDelta: () => {}, compaction: () => {} }
  return { emit, tokens }
}

/** A runner that ignores tools and emits a fixed final answer with no tool calls. */
class TextRunner implements ModelRunner {
  constructor(private readonly text: string) {}
  async run(_messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
    opts.onText(this.text)
    return new AIMessage(this.text)
  }
}

/** A runner that records the tool names it was handed, then emits a fixed answer (no tool calls). */
function spyRunner(): { runner: ModelRunner; seen: () => string[] } {
  let names: string[] = []
  return {
    runner: { async run(_m, opts) { names = opts.tools.map((t) => t.name); opts.onText('ok'); return new AIMessage('ok') } },
    seen: () => names,
  }
}

/** Scripted ModelRunner that returns each AIMessage in order (for doom-loop pause). */
function scriptRunner(script: AIMessage[]): ModelRunner {
  let i = 0
  return {
    async run(_messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
      opts.signal?.throwIfAborted?.()
      const m = script[Math.min(i, script.length - 1)]; i++
      if (typeof m.content === 'string' && m.content) opts.onText(m.content)
      return m
    },
  }
}

describe('runManagedAgent', () => {
  it('runs the loop with the injected runner and returns the final text', async () => {
    const cwd = tmp()
    const { emit, tokens } = collectingEmit()
    const text = await runManagedAgent({
      resolved: null, cwd, prompt: 'You are a tester.',
      task: 'say hi', emit, signal: new AbortController().signal, childMaxSteps: 5,
      runner: new TextRunner('done'),
      summarizer: { async summarize() { return '' } },
    })
    expect(text).toBe('done')
    expect(tokens.join('')).toBe('done')
  })

  it('returns first-line [hip:subagent_paused] when the child pauses (awaiting_user)', async () => {
    const cwd = tmp()
    // Repeat identical tool call to trip doom-loop → nudge → pause (see graph.test.ts / subagent.test.ts).
    const loop = () => new AIMessage({ content: '部分进展', tool_calls: [{ name: 'ls', args: { path: '/' }, id: 'x' }] })
    const text = await runManagedAgent({
      resolved: null, cwd, prompt: 'You are a tester.',
      task: 'loops', emit: collectingEmit().emit, signal: new AbortController().signal, childMaxSteps: 15,
      runner: scriptRunner([loop(), loop(), loop(), loop(), loop()]),
      summarizer: { async summarize() { return '' } },
    })
    expect(text).toContain('部分进展')
    expect(text).toMatch(/^\[hip:subagent_paused\]/)
    expect(text).not.toMatch(/sub-agent paused — open question/)
    expect(text).not.toMatch(/^Error: sub-agent paused/)
  })
})

describe('runManagedAgent built-in tools always on', () => {
  it("edit mode (default) grants the full built-in set incl. write_file/edit_file/write_todos", async () => {
    const cwd = tmp()
    writeFileSync(join(cwd, 'a.txt'), 'hello', 'utf8')
    const { runner, seen } = spyRunner()
    await runManagedAgent({
      resolved: null, cwd, prompt: 'p',
      task: 't', emit: collectingEmit().emit, signal: new AbortController().signal, childMaxSteps: 5,
      runner, summarizer: { async summarize() { return '' } },
    })
    expect(seen()).toContain('read_file')
    expect(seen()).toContain('write_file')
    expect(seen()).toContain('edit_file')
    expect(seen()).toContain('write_todos')
  })

  it("chat mode drops write_file/edit_file (read-only); keeps read_file", async () => {
    const cwd = tmp()
    const { runner, seen } = spyRunner()
    await runManagedAgent({
      resolved: null, cwd, prompt: 'p', permissionMode: 'chat',
      task: 't', emit: collectingEmit().emit, signal: new AbortController().signal, childMaxSteps: 5,
      runner, summarizer: { async summarize() { return '' } },
    })
    expect(seen()).not.toContain('write_file')
    expect(seen()).not.toContain('edit_file')
    expect(seen()).toContain('read_file')
  })

  it("chat mode with NO requestApproval (mirrors the real chat cascade) does not grant run_script", async () => {
    // In the live path session.ts passes requestApproval:undefined for chat, so run_script is never offered.
    // run_script gating is on requestApproval presence, NOT on mode — so we mirror the real cascade here.
    const cwd = tmp()
    const { runner, seen } = spyRunner()
    await runManagedAgent({
      resolved: null, cwd, prompt: 'p', permissionMode: 'chat',
      task: 't', emit: collectingEmit().emit, signal: new AbortController().signal, childMaxSteps: 5,
      runner, summarizer: { async summarize() { return '' } },
    })
    expect(seen()).not.toContain('run_script')
  })
})

describe('runManagedAgent skills + run_script wiring (no allow-list gate anymore)', () => {
  it('grants use_skill whenever skills are supplied', async () => {
    const cwd = tmp()
    const { runner, seen } = spyRunner()
    await runManagedAgent({
      resolved: null, cwd, prompt: 'p',
      task: 't', emit: collectingEmit().emit, signal: new AbortController().signal, childMaxSteps: 5,
      runner, summarizer: { async summarize() { return '' } },
      skills: [{ id: 'fmt', name: 'formatter', description: 'd', dir: cwd, hasScripts: false }],
    })
    expect(seen()).toContain('use_skill')
  })

  it('grants run_script whenever requestApproval is supplied', async () => {
    const cwd = tmp()
    const { runner, seen } = spyRunner()
    await runManagedAgent({
      resolved: null, cwd, prompt: 'p',
      task: 't', emit: collectingEmit().emit, signal: new AbortController().signal, childMaxSteps: 5,
      runner, summarizer: { async summarize() { return '' } },
      requestApproval: async () => ({ kind: 'allow_once' }),
    })
    expect(seen()).toContain('run_script')
  })

  it('does not grant run_script when requestApproval is absent', async () => {
    const cwd = tmp()
    const { runner, seen } = spyRunner()
    await runManagedAgent({
      resolved: null, cwd, prompt: 'p',
      task: 't', emit: collectingEmit().emit, signal: new AbortController().signal, childMaxSteps: 5,
      runner, summarizer: { async summarize() { return '' } },
    })
    expect(seen()).not.toContain('run_script')
  })
})

describe('runManagedAgent safety-dependency wiring (C3 — sessionId, networkPolicy, toolOutputStore, guardianReviewer)', () => {
  const makeNetworkPolicy = (): NetworkPolicy => new NetworkPolicy()
  const makeToolOutputStore = (): ToolOutputStore => new ToolOutputStore({ outputDir: join(tmpdir(), 'hip-tos-int') })
  const makeGuardianReviewer = (): GuardianReviewer => new GuardianReviewer({ modelRunner: new TextRunner('ok') })

  it('threads sessionId and networkPolicy into buildTools opts', async () => {
    const cwd = tmp()
    const policy = makeNetworkPolicy()
    const store = makeToolOutputStore()
    const guardian = makeGuardianReviewer()

    await runManagedAgent({
      resolved: null, cwd, prompt: 'p',
      task: 't', emit: collectingEmit().emit, signal: new AbortController().signal, childMaxSteps: 5,
      runner: new TextRunner('done'),
      summarizer: { async summarize() { return '' } },
      sessionId: 'mgr-sess-1',
      networkPolicy: policy,
      toolOutputStore: store,
      guardianReviewer: guardian,
    })

    const lastOpts = capturedBuildToolsOpts.at(-1)
    expect(lastOpts).toBeDefined()
    expect(lastOpts?.sessionId).toBe('mgr-sess-1')
    expect(lastOpts?.networkPolicy).toBe(policy)
  })

  it('threads sessionId, toolOutputStore, and guardianReviewer into GraphCtx', async () => {
    const cwd = tmp()
    const policy = makeNetworkPolicy()
    const store = makeToolOutputStore()
    const guardian = makeGuardianReviewer()

    await runManagedAgent({
      resolved: null, cwd, prompt: 'p',
      task: 't', emit: collectingEmit().emit, signal: new AbortController().signal, childMaxSteps: 5,
      runner: new TextRunner('done'),
      summarizer: { async summarize() { return '' } },
      sessionId: 'mgr-sess-2',
      networkPolicy: policy,
      toolOutputStore: store,
      guardianReviewer: guardian,
    })

    const ctx = capturedGraphCtxs.at(-1)
    expect(ctx).toBeDefined()
    expect(ctx?.sessionId).toBe('mgr-sess-2')
    expect(ctx?.toolOutputStore).toBe(store)
    expect(ctx?.guardianReviewer).toBe(guardian)
  })

  it('defaults sessionId to "managed-agent" when not provided', async () => {
    const cwd = tmp()

    await runManagedAgent({
      resolved: null, cwd, prompt: 'p',
      task: 't', emit: collectingEmit().emit, signal: new AbortController().signal, childMaxSteps: 5,
      runner: new TextRunner('done'),
      summarizer: { async summarize() { return '' } },
    })

    const ctx = capturedGraphCtxs.at(-1)
    expect(ctx?.sessionId).toBe('managed-agent')
  })
})

describe('runManagedAgent attachmentParts + task behavior', () => {
  function messageCapturingRunner(): { runner: ModelRunner; human: () => HumanMessage | undefined } {
    const captured: BaseMessage[] = []
    return {
      runner: {
        async run(messages, opts) {
          captured.push(...messages)
          opts.onText('ok')
          return new AIMessage('ok')
        },
      },
      human: () => captured.find((m) => m instanceof HumanMessage) as HumanMessage | undefined,
    }
  }

  it('prepends task as first text part when both attachmentParts and task are provided', async () => {
    const cwd = tmp()
    const { runner, human } = messageCapturingRunner()
    await runManagedAgent({
      resolved: null, cwd, prompt: 'p',
      task: 'hello',
      attachmentParts: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } }],
      emit: collectingEmit().emit, signal: new AbortController().signal, childMaxSteps: 5,
      runner, summarizer: { async summarize() { return '' } },
    })
    const msg = human()
    expect(msg).toBeDefined()
    const parts = msg!.content as Array<{ type: string; text?: string; image_url?: { url: string } }>
    expect(Array.isArray(parts)).toBe(true)
    expect(parts).toHaveLength(2)
    expect(parts[0]).toEqual({ type: 'text', text: 'hello' })
    expect(parts[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } })
  })

  it('passes attachmentParts through unchanged when no task is provided', async () => {
    const cwd = tmp()
    const { runner, human } = messageCapturingRunner()
    await runManagedAgent({
      resolved: null, cwd, prompt: 'p',
      task: '',
      attachmentParts: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } }],
      emit: collectingEmit().emit, signal: new AbortController().signal, childMaxSteps: 5,
      runner, summarizer: { async summarize() { return '' } },
    })
    const msg = human()
    expect(msg).toBeDefined()
    const parts = msg!.content as Array<{ type: string; image_url?: { url: string } }>
    expect(Array.isArray(parts)).toBe(true)
    expect(parts).toHaveLength(1)
    expect(parts[0]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } })
  })

  it('creates a single text part when only task is provided (no attachmentParts)', async () => {
    const cwd = tmp()
    const { runner, human } = messageCapturingRunner()
    await runManagedAgent({
      resolved: null, cwd, prompt: 'p',
      task: 'hello world',
      emit: collectingEmit().emit, signal: new AbortController().signal, childMaxSteps: 5,
      runner, summarizer: { async summarize() { return '' } },
    })
    const msg = human()
    expect(msg).toBeDefined()
    // When there's a single text part, HumanMessage stores it as a plain string
    expect(typeof msg!.content).toBe('string')
    expect(msg!.content).toBe('hello world')
  })

  it('creates an empty HumanMessage when neither task nor attachmentParts is provided', async () => {
    const cwd = tmp()
    const { runner, human } = messageCapturingRunner()
    await runManagedAgent({
      resolved: null, cwd, prompt: 'p',
      task: '',
      emit: collectingEmit().emit, signal: new AbortController().signal, childMaxSteps: 5,
      runner, summarizer: { async summarize() { return '' } },
    })
    const msg = human()
    expect(msg).toBeDefined()
    expect(msg!.content).toBe('')
  })

  it('handles empty task and empty attachmentParts array gracefully', async () => {
    const cwd = tmp()
    const { runner, human } = messageCapturingRunner()
    await runManagedAgent({
      resolved: null, cwd, prompt: 'p',
      task: '',
      attachmentParts: [],
      emit: collectingEmit().emit, signal: new AbortController().signal, childMaxSteps: 5,
      runner, summarizer: { async summarize() { return '' } },
    })
    const msg = human()
    expect(msg).toBeDefined()
    expect(msg!.content).toBe('')
  })
})

describe('runManagedAgent attachments', () => {
  it('includes image attachments as content parts in the human message', async () => {
    const cwd = tmp()
    const imgPath = join(cwd, 'test.png')
    writeFileSync(imgPath, Buffer.from('fake-image-bytes'))
    const captured: BaseMessage[] = []
    const runner: ModelRunner = {
      async run(messages, opts) {
        captured.push(...messages)
        opts.onText('ok')
        return new AIMessage('ok')
      },
    }
    await runManagedAgent({
      resolved: null,
      cwd,
      prompt: 'p',
      task: 'describe',
      attachments: [{ id: 'a1', name: 'test.png', mimeType: 'image/png', path: imgPath }],
      emit: collectingEmit().emit,
      signal: new AbortController().signal,
      childMaxSteps: 5,
      runner,
      summarizer: { async summarize() { return '' } },
    })
    const human = captured.find((m) => m instanceof HumanMessage)
    expect(human).toBeDefined()
    expect(Array.isArray(human!.content)).toBe(true)
    const parts = human!.content as Array<{ type: string }>
    expect(parts).toHaveLength(2)
    expect(parts[0]).toEqual({ type: 'text', text: 'describe' })
    expect(parts[1].type).toBe('image_url')
  })
})
