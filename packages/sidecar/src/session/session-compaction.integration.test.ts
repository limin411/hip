import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import { Session } from './session.js'
import { buildGraph } from './graph.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import type { Summarizer } from './compaction.js'
import type { ServerMessage } from '@hip/protocol'

function fakeRunner(script: AIMessage[]): ModelRunner {
  let i = 0
  return {
    async run(_m: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
      const m = script[Math.min(i, script.length - 1)]; i++
      if (typeof m.content === 'string' && m.content) opts.onText(m.content)
      return m
    },
  }
}

const fakeSummarizer: Summarizer = {
  async summarize() { return '早期对话摘要' },
}

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'hip-compact-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('Session compaction restores compacted message history', () => {
  it('updates session.messages to the compacted summary after a compacting turn', async () => {
    // Budget of 1 token forces compaction as soon as there is any middle to summarize.
    const responses = [
      new AIMessage('reply one'),
      new AIMessage('reply two'),
      new AIMessage('reply three'),
      new AIMessage('reply four'),
      new AIMessage('reply five'),
      new AIMessage('final reply'),
    ]
    const runner = fakeRunner(responses)
    const session = new Session(
      's-compact',
      { llmProvider: 'deepseek', model: '', tools: [], cwd: root } as any,
      undefined,
      undefined,
      undefined,
      undefined,
      runner,
      fakeSummarizer,
    )
    // Force a tiny compaction budget so the sixth turn compacts the middle.
    ;(session as any).app = buildGraph(25, 1)

    const sent: ServerMessage[] = []
    const send = (m: ServerMessage) => sent.push(m)

    for (let i = 1; i <= 5; i++) {
      await session.sendMessage(`question ${i}`, send)
    }
    const beforeCompact = (session as any).messages.length as number
    await session.sendMessage('question six', send)
    const afterCompact = (session as any).messages.length as number

    // The sixth turn must have triggered compaction.
    expect(sent.some((m) => m.type === 'message:complete')).toBe(true)
    const messages: BaseMessage[] = (session as any).messages
    const texts = messages.map((m) => typeof m.content === 'string' ? m.content : '')
    expect(texts.some((t) => t.includes('早期对话摘要'))).toBe(true)
    expect(texts.some((t) => t.includes('reply two'))).toBe(false)
  })
})
