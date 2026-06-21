import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, SystemMessage, type AIMessage as AIMsg, type BaseMessage } from '@langchain/core/messages'
import { runSubagent } from './subagent.js'
import { buildTools } from './tools.js'
import type { GraphEmit } from './graph.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import type { Summarizer } from './compaction.js'
import type { ApprovalFn } from './tools.js'

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

  it('is depth-1: the child toolset has no task tool', async () => {
    await withTmp(async (root) => {
      // Child asks for `task`; toolsNode returns an unknown-tool ToolMessage, then the child answers.
      const text = await runSubagent({
        runner: fakeRunner([
          new AIMessage({ content: '', tool_calls: [{ name: 'task', args: { description: 'recurse' }, id: 'c1' }] }),
          new AIMessage('无法继续委派，已直接处理'),
        ]),
        root, summarizer: noopSummarizer, emit: noopEmit,
        signal: new AbortController().signal, description: 'try to recurse', childMaxSteps: 15,
      })
      expect(buildTools(root).map((t) => t.name)).not.toContain('task')
      expect(text).toBe('无法继续委派，已直接处理')
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
