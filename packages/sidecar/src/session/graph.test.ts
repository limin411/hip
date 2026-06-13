import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, HumanMessage, type AIMessage as AIMsg, type BaseMessage } from '@langchain/core/messages'
import { buildTools } from './tools.js'
import { buildGraph, type GraphEmit } from './graph.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'

/** Fake runner: returns the scripted message for each successive turn. */
function fakeRunner(script: AIMsg[]): ModelRunner {
  let i = 0
  return {
    async run(_messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMsg> {
      const m = script[Math.min(i, script.length - 1)]
      i++
      if (typeof m.content === 'string' && m.content) opts.onText(m.content)
      return m
    },
  }
}

const noopEmit: GraphEmit = { token: () => {}, reasoning: () => {}, toolStarted: () => {}, toolFinished: () => {} }

describe('agent loop graph', () => {
  it('stops immediately when the model returns a plain text answer', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hip-graph-'))
    try {
      const app = buildGraph()
      const runner = fakeRunner([new AIMessage('你好，我是助手')])
      const out = await app.invoke(
        { messages: [new HumanMessage('你是谁')], steps: 0 },
        { configurable: { ctx: { runner, tools: buildTools(root), emit: noopEmit } } },
      )
      const last = out.messages[out.messages.length - 1] as AIMessage
      expect(last.content).toBe('你好，我是助手')
      expect(out.steps).toBe(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('executes a write_file tool call then loops back and finishes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hip-graph-'))
    try {
      const app = buildGraph()
      const runner = fakeRunner([
        new AIMessage({
          content: '',
          tool_calls: [{ name: 'write_file', args: { path: '/index.html', content: '<h1>me</h1>' }, id: 'c1' }],
        }),
        new AIMessage('已创建 /index.html'),
      ])
      const started: string[] = []
      const out = await app.invoke(
        { messages: [new HumanMessage('做个 HTML 自我介绍')], steps: 0 },
        {
          configurable: {
            ctx: {
              runner,
              tools: buildTools(root),
              emit: { ...noopEmit, toolStarted: (n: string) => started.push(n) },
            },
          },
        },
      )
      expect(readFileSync(join(root, 'index.html'), 'utf8')).toBe('<h1>me</h1>')
      expect(started).toContain('write_file')
      expect(out.steps).toBe(2)
      expect((out.messages[out.messages.length - 1] as AIMessage).content).toBe('已创建 /index.html')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('terminates at the step cap even if the model keeps requesting tools', async () => {
    const root = mkdtempSync(join(tmpdir(), 'hip-graph-'))
    try {
      const app = buildGraph(2) // tiny cap for the test
      const loopMsg = new AIMessage({
        content: '',
        tool_calls: [{ name: 'ls', args: { path: '/' }, id: 'x' }],
      })
      const runner = fakeRunner([loopMsg])
      const out = await app.invoke(
        { messages: [new HumanMessage('spin')], steps: 0 },
        { configurable: { ctx: { runner, tools: buildTools(root), emit: noopEmit } }, recursionLimit: 50 },
      )
      expect(out.steps).toBeLessThanOrEqual(2)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
