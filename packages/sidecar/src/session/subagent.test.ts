import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, type AIMessage as AIMsg, type BaseMessage } from '@langchain/core/messages'
import { runSubagent } from './subagent.js'
import { buildTools } from './tools.js'
import type { GraphEmit } from './graph.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import type { Summarizer } from './compaction.js'

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

const noopEmit: GraphEmit = { token: () => {}, reasoning: () => {}, toolStarted: () => {}, toolFinished: () => {}, usage: () => {} }
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
