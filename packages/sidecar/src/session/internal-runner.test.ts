import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import type { GraphEmit } from './graph.js'
import { runManagedAgent } from './internal-runner.js'

const dirs: string[] = []
function tmp() { const d = mkdtempSync(join(tmpdir(), 'hip-internal-')); dirs.push(d); return d }
afterEach(() => { while (dirs.length) { try { rmSync(dirs.pop()!, { recursive: true, force: true }) } catch { /* ignore */ } } })

function collectingEmit() {
  const tokens: string[] = []
  const emit: GraphEmit = { token: (d) => tokens.push(d), reasoning: () => {}, toolStarted: () => {}, toolFinished: () => {}, usage: () => {} }
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
