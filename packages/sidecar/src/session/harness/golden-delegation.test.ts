/**
 * Sprint A — golden harness cases (fake LLM, no paid API).
 * Locks simple-task non-delegation and empty sub-agent failure messaging.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, type AIMessage as AIMsg, type BaseMessage } from '@langchain/core/messages'
import { Session } from '../session.js'
import type { ModelRunner, ModelRunOptions } from '../model-runner.js'
import type { ServerMessage } from '@hip/protocol'
import { buildSubagentTools } from '../tools/subagent.js'

function fakeRunner(script: AIMsg[]): ModelRunner {
  let i = 0
  return {
    async run(_m: BaseMessage[], opts: ModelRunOptions): Promise<AIMsg> {
      const m = script[Math.min(i, script.length - 1)]
      i++
      if (typeof m.content === 'string' && m.content) opts.onText?.(m.content)
      return m
    },
  }
}

function toolStarts(sent: ServerMessage[]): string[] {
  return sent
    .filter((m): m is Extract<ServerMessage, { type: 'tool:started' }> => m.type === 'tool:started')
    .map((m) => m.name)
}

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hip-harness-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('harness golden delegation (H-simple-*)', () => {
  it('H-simple-hi: text-only reply never starts task/dispatch_agent', async () => {
    const runner = fakeRunner([new AIMessage('Hey! I am hip.')])
    const session = new Session(
      'h-hi',
      { llmProvider: 'deepseek', model: '', tools: [], cwd: root } as never,
      undefined,
      undefined,
      undefined,
      undefined,
      runner,
    )
    const sent: ServerMessage[] = []
    await session.sendMessage('hi', (m) => sent.push(m))
    const names = toolStarts(sent)
    expect(names).not.toContain('task')
    expect(names).not.toContain('dispatch_agent')
    const complete = sent.find((m) => m.type === 'message:complete') as Extract<
      ServerMessage,
      { type: 'message:complete' }
    >
    expect(complete?.message.content).toMatch(/hip/i)
  })

  it('H-simple-ls: single ls then text, no task', async () => {
    const runner = fakeRunner([
      new AIMessage({
        content: '',
        tool_calls: [{ name: 'ls', args: { path: '/' }, id: 'c1' }],
      }),
      new AIMessage('Directory listing above.'),
    ])
    const session = new Session(
      'h-ls',
      { llmProvider: 'deepseek', model: '', tools: [], cwd: root } as never,
      undefined,
      undefined,
      undefined,
      undefined,
      runner,
    )
    const sent: ServerMessage[] = []
    await session.sendMessage('list files here', (m) => sent.push(m))
    const names = toolStarts(sent)
    expect(names.filter((n) => n === 'ls').length).toBeGreaterThanOrEqual(1)
    expect(names).not.toContain('task')
    expect(names).not.toContain('dispatch_agent')
  })
})

describe('harness empty sub-agent (H-empty-child)', () => {
  it('task tool returns Error when spawn returns empty string', async () => {
    const { subagentTools } = buildSubagentTools(async () => '')
    const task = subagentTools.find((t) => t.name === 'task')!
    const out = String(await task.invoke({ description: 'do stuff' }))
    expect(out.startsWith('Error:')).toBe(true)
    expect(out).toMatch(/empty output/i)
  })

  it('task tool returns child text when non-empty', async () => {
    const { subagentTools } = buildSubagentTools(async () => '  done  ')
    const task = subagentTools.find((t) => t.name === 'task')!
    const out = String(await task.invoke({ description: 'do stuff' }))
    expect(out).toBe('  done  ')
  })
})
