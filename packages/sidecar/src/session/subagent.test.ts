import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, SystemMessage, type AIMessage as AIMsg, type BaseMessage } from '@langchain/core/messages'
import { runSubagent } from './subagent.js'
import { buildTools } from './tools.js'
import type { GraphEmit, GraphCtx } from './graph.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import type { Summarizer } from './compaction.js'
import type { ApprovalFn } from './tools.js'
import { NetworkPolicy } from './network-policy.js'
import { ToolOutputStore } from './tool-output-store.js'
import { GuardianReviewer } from './guardian.js'

// ── Safety-dep wiring test harness ────────────────────────────────────────
// vi.mock calls are hoisted by vitest. Shared state lives in vi.hoisted.
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

function fakeRunner(script: AIMsg[]): ModelRunner {
  let i = 0
  return {
    async run(_messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMsg> {
      opts.signal?.throwIfAborted?.()
      const m = script[Math.min(i, script.length - 1)]; i++
      if (typeof m.content === 'string' && m.content) opts.onText(m.content)
      return m
    },
  }
}

const noopEmit: GraphEmit = { token: () => {}, reasoning: () => {}, toolStarted: () => {}, toolFinished: () => {}, usage: () => {}, planDelta: () => {}, compaction: () => {} }
const noopSummarizer: Summarizer = { async summarize() { return '' } }
const withTmp = async (fn: (root: string) => Promise<void>) => {
  const root = mkdtempSync(join(tmpdir(), 'hip-subagent-'))
  try { await fn(root) } finally { rmSync(root, { recursive: true, force: true }) }
}

beforeEach(() => {
  capturedBuildToolsOpts.length = 0
  capturedGraphCtxs.length = 0
})

describe('runSubagent', () => {
  it('returns the child final assistant text', async () => {
    await withTmp(async (root) => {
      const text = await runSubagent({
        runner: fakeRunner([new AIMessage('调查完成：未发现问题')]),
        root, summarizer: noopSummarizer, emit: noopEmit,
        signal: new AbortController().signal, description: 'look into X', childMaxSteps: 15,
      })
      expect(text).toBe('调查完成：未发现问题')
    })
  })

  it('filters task/task_batch tools when depth >= MAX_DEPTH', async () => {
    await withTmp(async (root) => {
      // At depth=MAX_DEPTH (3), delegation tools are stripped from the child's toolset.
      // The child asks for `task`; toolsNode returns an unknown-tool ToolMessage, then the child answers.
      const text = await runSubagent({
        runner: fakeRunner([
          new AIMessage({ content: '', tool_calls: [{ name: 'task', args: { description: 'recurse' }, id: 'c1' }] }),
          new AIMessage('无法继续委派，已直接处理'),
        ]),
        root, summarizer: noopSummarizer, emit: noopEmit,
        signal: new AbortController().signal, description: 'try to recurse', childMaxSteps: 15,
        depth: 3,
      })
      expect(buildTools(root).map((t) => t.name)).not.toContain('task')
      expect(text).toBe('无法继续委派，已直接处理')
    })
  })

  it('includes task/task_batch tools when depth < MAX_DEPTH', async () => {
    await withTmp(async (root) => {
      const runner = new ToolCapturingRunner()
      await runSubagent({
        runner, root, summarizer: noopSummarizer, emit: noopEmit,
        signal: new AbortController().signal, description: 'test', childMaxSteps: 15,
        depth: 1,
      })
      expect(runner.toolNames).toContain('task')
      expect(runner.toolNames).toContain('task_batch')
    })
  })

  it('propagates a pre-aborted parent signal (child stream throws → rejects)', async () => {
    await withTmp(async (root) => {
      const ac = new AbortController(); ac.abort()
      await expect(runSubagent({
        runner: fakeRunner([new AIMessage('should not reach')]),
        root, summarizer: noopSummarizer, emit: noopEmit,
        signal: ac.signal, description: 'aborted', childMaxSteps: 15,
      })).rejects.toThrow()
    })
  })

  it('returns partial text when the child pauses (awaiting_user), no escalation', async () => {
    await withTmp(async (root) => {
      // Repeat the identical tool call enough to trip doom-loop → nudge → pause (see graph.test.ts).
      const loop = () => new AIMessage({ content: '部分进展', tool_calls: [{ name: 'ls', args: { path: '/' }, id: 'x' }] })
      const text = await runSubagent({
        runner: fakeRunner([loop(), loop(), loop(), loop(), loop()]),
        root, summarizer: noopSummarizer, emit: noopEmit,
        signal: new AbortController().signal, description: 'loops', childMaxSteps: 15,
      })
      expect(text).toContain('部分进展')
    })
  })
})

/** A ModelRunner that records the system prompt + bound tool names it was handed, then issues each
 *  scripted tool call (so the child loop actually runs that tool) and finally answers with plain text. */
class CapturingChildRunner implements ModelRunner {
  systemPrompt = ''
  toolNames: string[] = []
  private call = 0
  constructor(private readonly toolCalls: Array<{ name: string; args: Record<string, unknown> }>) {}
  async run(messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMsg> {
    opts.signal?.throwIfAborted?.()
    const sys = messages[0]
    this.systemPrompt = sys instanceof SystemMessage && typeof sys.content === 'string' ? sys.content : String(sys?.content ?? '')
    this.toolNames = opts.tools.map((t) => t.name)
    const tc = this.toolCalls[this.call]
    this.call += 1
    if (tc) {
      return new AIMessage({ content: '', tool_calls: [{ name: tc.name, args: tc.args, id: `c${this.call}` }] })
    }
    opts.onText('done')
    return new AIMessage('done')
  }
}

/** A ModelRunner that captures the tool list it receives, then immediately answers. */
class ToolCapturingRunner implements ModelRunner {
  toolNames: string[] = []
  async run(messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMsg> {
    opts.signal?.throwIfAborted?.()
    this.toolNames = opts.tools.map((t) => t.name)
    opts.onText('done')
    return new AIMessage('done')
  }
}

describe('runSubagent permissionMode cascade (FIX 1 — task worker honors the conversation mode)', () => {
  it("chat mode: the task worker has NO write_file/edit_file/run_script and a read-only child prompt", async () => {
    await withTmp(async (root) => {
      const runner = new CapturingChildRunner([])
      await runSubagent({
        runner, root, summarizer: noopSummarizer, emit: noopEmit,
        signal: new AbortController().signal, description: 'inspect only', childMaxSteps: 15,
        permissionMode: 'chat',
        requestApproval: async () => ({ kind: 'allow_once' }),
      })
      expect(runner.toolNames).not.toContain('write_file')
      expect(runner.toolNames).not.toContain('edit_file')
      expect(runner.toolNames).not.toContain('run_script')
      expect(runner.toolNames).toContain('read_file')
      expect(runner.systemPrompt).toMatch(/read-only/i)
    })
  })

  it("edit mode (default): the task worker has write_file + edit_file and a sandboxed child prompt", async () => {
    await withTmp(async (root) => {
      const runner = new CapturingChildRunner([])
      await runSubagent({
        runner, root, summarizer: noopSummarizer, emit: noopEmit,
        signal: new AbortController().signal, description: 'edit it', childMaxSteps: 15,
        permissionMode: 'edit',
        requestApproval: async () => ({ kind: 'allow_once' }),
      })
      expect(runner.toolNames).toContain('write_file')
      expect(runner.toolNames).toContain('edit_file')
      expect(runner.systemPrompt).toMatch(/sandboxed to it/i)
    })
  })

  it("full mode: the task worker un-jails writes (absolute path OUTSIDE root) and auto-approves run_script", async () => {
    await withTmp(async (root) => {
      const outside = mkdtempSync(join(tmpdir(), 'hip-subagent-outside-'))
      const target = join(outside, 'escaped.txt')
      const flag = join(outside, 'ran.txt')
      let approvalCalls = 0
      const autoApprove: ApprovalFn = async () => { approvalCalls += 1; return { kind: 'allow_once' } }
      try {
        const runner = new CapturingChildRunner([
          { name: 'write_file', args: { path: target, content: 'OUT' } },
          { name: 'run_script', args: { command: `: > '${flag}'`, reason: 'touch a flag' } },
        ])
        await runSubagent({
          runner, root, summarizer: noopSummarizer, emit: noopEmit,
          signal: new AbortController().signal, description: 'full power', childMaxSteps: 15,
          permissionMode: 'full',
          requestApproval: autoApprove,
        })
        // un-jailed write landed OUTSIDE root
        expect(existsSync(target)).toBe(true)
        expect(readFileSync(target, 'utf8')).toBe('OUT')
        // run_script ran (auto-approved closure resolved allow without blocking)
        expect(runner.toolNames).toContain('run_script')
        expect(approvalCalls).toBeGreaterThanOrEqual(1)
        expect(existsSync(flag)).toBe(true)
        expect(runner.systemPrompt).toMatch(/not sandboxed/i)
      } finally {
        rmSync(outside, { recursive: true, force: true })
      }
    })
  })

  it("default (no permissionMode arg) behaves like edit — write/edit present, sandboxed prompt", async () => {
    await withTmp(async (root) => {
      const runner = new CapturingChildRunner([])
      await runSubagent({
        runner, root, summarizer: noopSummarizer, emit: noopEmit,
        signal: new AbortController().signal, description: 'no mode', childMaxSteps: 15,
      })
      expect(runner.toolNames).toContain('write_file')
      expect(runner.toolNames).toContain('edit_file')
      expect(runner.systemPrompt).toMatch(/sandboxed to it/i)
    })
  })
})

describe('runSubagent safety-dependency wiring (C3 — sessionId, networkPolicy, toolOutputStore, guardianReviewer)', () => {
  const makeNetworkPolicy = (): NetworkPolicy => new NetworkPolicy()
  const makeToolOutputStore = (): ToolOutputStore => new ToolOutputStore({ outputDir: join(tmpdir(), 'hip-tos-test') })
  const makeGuardianReviewer = (): GuardianReviewer => new GuardianReviewer({ modelRunner: fakeRunner([new AIMessage('ok')]) })

  it('threads sessionId and networkPolicy into buildTools opts', async () => {
    await withTmp(async (root) => {
      const policy = makeNetworkPolicy()
      const store = makeToolOutputStore()
      const guardian = makeGuardianReviewer()

      await runSubagent({
        runner: fakeRunner([new AIMessage('done')]),
        root, summarizer: noopSummarizer, emit: noopEmit,
        signal: new AbortController().signal, description: 'wire-check', childMaxSteps: 5,
        sessionId: 'sess-42',
        networkPolicy: policy,
        toolOutputStore: store,
        guardianReviewer: guardian,
      })

      const lastOpts = capturedBuildToolsOpts.at(-1)
      expect(lastOpts).toBeDefined()
      expect(lastOpts?.sessionId).toBe('sess-42')
      expect(lastOpts?.networkPolicy).toBe(policy)
    })
  })

  it('threads sessionId, toolOutputStore, and guardianReviewer into GraphCtx', async () => {
    await withTmp(async (root) => {
      const policy = makeNetworkPolicy()
      const store = makeToolOutputStore()
      const guardian = makeGuardianReviewer()

      await runSubagent({
        runner: fakeRunner([new AIMessage('done')]),
        root, summarizer: noopSummarizer, emit: noopEmit,
        signal: new AbortController().signal, description: 'ctx-wire', childMaxSteps: 5,
        sessionId: 'sess-99',
        networkPolicy: policy,
        toolOutputStore: store,
        guardianReviewer: guardian,
      })

      const ctx = capturedGraphCtxs.at(-1)
      expect(ctx).toBeDefined()
      expect(ctx?.sessionId).toBe('sess-99')
      expect(ctx?.toolOutputStore).toBe(store)
      expect(ctx?.guardianReviewer).toBe(guardian)
    })
  })

  it('defaults sessionId to "subagent" when not provided', async () => {
    await withTmp(async (root) => {
      await runSubagent({
        runner: fakeRunner([new AIMessage('done')]),
        root, summarizer: noopSummarizer, emit: noopEmit,
        signal: new AbortController().signal, description: 'default-id', childMaxSteps: 5,
      })

      const ctx = capturedGraphCtxs.at(-1)
      expect(ctx?.sessionId).toBe('subagent')
    })
  })
})
