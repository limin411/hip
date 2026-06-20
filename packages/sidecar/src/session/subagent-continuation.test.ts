import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import { runSubagent } from './subagent.js'
import type { GraphEmit } from './graph.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import type { Summarizer } from './compaction.js'

const noopEmit: GraphEmit = { token: () => {}, reasoning: () => {}, toolStarted: () => {}, toolFinished: () => {}, usage: () => {}, planDelta: () => {} }
const noopSummarizer: Summarizer = { async summarize() { return '' } }
const withTmp = async (fn: (root: string) => Promise<void>) => {
  const root = mkdtempSync(join(tmpdir(), 'hip-subagent-cont-'))
  try { await fn(root) } finally { rmSync(root, { recursive: true, force: true }) }
}

function fakeRunner(script: AIMessage[]): ModelRunner {
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

/** A ModelRunner that captures the full messages array it receives. */
class CapturingRunner implements ModelRunner {
  captured: BaseMessage[] = []
  async run(messages: BaseMessage[], _opts: ModelRunOptions): Promise<AIMessage> {
    this.captured = messages
    return new AIMessage('done')
  }
}

describe('runSubagent continuation (existingMessages)', () => {
  it('uses fresh [system, human] when no existingMessages provided', async () => {
    await withTmp(async (root) => {
      const runner = new CapturingRunner()
      await runSubagent({
        runner, root, summarizer: noopSummarizer, emit: noopEmit,
        signal: new AbortController().signal, description: 'research X', childMaxSteps: 15,
      })
      expect(runner.captured).toHaveLength(2)
      expect(runner.captured[0]).toBeInstanceOf(SystemMessage)
      expect(runner.captured[1]).toBeInstanceOf(HumanMessage)
      expect((runner.captured[1] as HumanMessage).content).toBe('research X')
    })
  })

  it('empty existingMessages array still uses fresh [system, human]', async () => {
    await withTmp(async (root) => {
      const runner = new CapturingRunner()
      await runSubagent({
        runner, root, summarizer: noopSummarizer, emit: noopEmit,
        signal: new AbortController().signal, description: 'task', childMaxSteps: 15,
        existingMessages: [],
      })
      expect(runner.captured).toHaveLength(2)
      expect(runner.captured[0]).toBeInstanceOf(SystemMessage)
    })
  })

  it('preserves prior assistant message in context when existingMessages provided', async () => {
    await withTmp(async (root) => {
      const prior: BaseMessage[] = [
        new HumanMessage('previous request'),
        new AIMessage('previous response'),
      ]
      const runner = new CapturingRunner()
      await runSubagent({
        runner, root, summarizer: noopSummarizer, emit: noopEmit,
        signal: new AbortController().signal, description: 'continue working', childMaxSteps: 15,
        existingMessages: prior,
      })
      // Should have: [HumanMessage('previous request'), AIMessage('previous response'), HumanMessage('continue working')]
      expect(runner.captured).toHaveLength(3)
      expect(runner.captured[0]).toBeInstanceOf(HumanMessage)
      expect((runner.captured[0] as HumanMessage).content).toBe('previous request')
      expect(runner.captured[1]).toBeInstanceOf(AIMessage)
      expect((runner.captured[1] as AIMessage).content).toBe('previous response')
      expect(runner.captured[2]).toBeInstanceOf(HumanMessage)
      expect((runner.captured[2] as HumanMessage).content).toBe('continue working')
      // No SystemMessage when existingMessages is provided
      expect(runner.captured.every((m) => !(m instanceof SystemMessage))).toBe(true)
    })
  })

  it('subagent with existingMessages still produces correct output', async () => {
    await withTmp(async (root) => {
      const prior: BaseMessage[] = [
        new HumanMessage('what is 2+2'),
        new AIMessage('4'),
      ]
      const text = await runSubagent({
        runner: fakeRunner([new AIMessage('OK, continuing')]),
        root, summarizer: noopSummarizer, emit: noopEmit,
        signal: new AbortController().signal, description: 'continue the math', childMaxSteps: 15,
        existingMessages: prior,
      })
      expect(text).toBe('OK, continuing')
    })
  })

  it('multiple turns of continuation accumulate context', async () => {
    await withTmp(async (root) => {
      // Simulate turn 1
      const turn1Prior: BaseMessage[] = [
        new HumanMessage('task A'),
        new AIMessage('result A'),
      ]
      let runner = new CapturingRunner()
      await runSubagent({
        runner, root, summarizer: noopSummarizer, emit: noopEmit,
        signal: new AbortController().signal, description: 'task B', childMaxSteps: 15,
        existingMessages: turn1Prior,
      })
      expect(runner.captured).toHaveLength(3)
      expect(runner.captured[0]).toBeInstanceOf(HumanMessage)
      expect((runner.captured[0] as HumanMessage).content).toBe('task A')
      expect(runner.captured[1]).toBeInstanceOf(AIMessage)
      expect((runner.captured[1] as AIMessage).content).toBe('result A')
      expect(runner.captured[2]).toBeInstanceOf(HumanMessage)
      expect((runner.captured[2] as HumanMessage).content).toBe('task B')

      // Simulate turn 2 with accumulated context
      const turn2Prior: BaseMessage[] = [...turn1Prior, new HumanMessage('task B'), new AIMessage('result B')]
      runner = new CapturingRunner()
      await runSubagent({
        runner, root, summarizer: noopSummarizer, emit: noopEmit,
        signal: new AbortController().signal, description: 'task C', childMaxSteps: 15,
        existingMessages: turn2Prior,
      })
      expect(runner.captured).toHaveLength(5)
      expect(runner.captured[3]).toBeInstanceOf(AIMessage)
      expect((runner.captured[3] as AIMessage).content).toBe('result B')
      expect(runner.captured[4]).toBeInstanceOf(HumanMessage)
      expect((runner.captured[4] as HumanMessage).content).toBe('task C')
    })
  })
})
