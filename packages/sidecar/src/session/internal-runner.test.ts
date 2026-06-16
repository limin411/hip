import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import type { GraphEmit } from './graph.js'
import { filterTools, runManagedAgent } from './internal-runner.js'
import { buildTools } from './tools.js'

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

describe('filterTools', () => {
  it('keeps all tools when allowedTools is undefined', () => {
    const tools = buildTools('/proj')
    expect(filterTools(tools, undefined)).toHaveLength(tools.length)
  })
  it('keeps only the named tools', () => {
    const tools = buildTools('/proj')
    const kept = filterTools(tools, ['read_file', 'grep']).map((t) => t.name).sort()
    expect(kept).toEqual(['grep', 'read_file'])
  })
})

describe('runManagedAgent', () => {
  it('runs the loop with the injected runner and returns the final text', async () => {
    const cwd = tmp()
    const { emit, tokens } = collectingEmit()
    const text = await runManagedAgent({
      resolved: null, cwd, prompt: 'You are a tester.', allowedTools: ['read_file'],
      task: 'say hi', emit, signal: new AbortController().signal, childMaxSteps: 5,
      runner: new TextRunner('done'),
      summarizer: { async summarize() { return '' } },
    })
    expect(text).toBe('done')
    expect(tokens.join('')).toBe('done')
  })

  it('a read-only allow-list produces a toolset with no write_file', async () => {
    const cwd = tmp()
    writeFileSync(join(cwd, 'a.txt'), 'hello', 'utf8')
    let seenToolNames: string[] = []
    const runner: ModelRunner = {
      async run(_m, opts) { seenToolNames = opts.tools.map((t) => t.name); opts.onText('ok'); return new AIMessage('ok') },
    }
    await runManagedAgent({
      resolved: null, cwd, prompt: 'read only', allowedTools: ['read_file', 'ls', 'glob', 'grep'],
      task: 't', emit: collectingEmit().emit, signal: new AbortController().signal, childMaxSteps: 5,
      runner, summarizer: { async summarize() { return '' } },
    })
    expect(seenToolNames).not.toContain('write_file')
    expect(seenToolNames).not.toContain('edit_file')
    expect(seenToolNames).toContain('read_file')
  })
})
