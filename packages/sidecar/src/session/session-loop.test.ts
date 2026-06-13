import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, type AIMessage as AIMsg, type BaseMessage } from '@langchain/core/messages'
import { Session } from './session.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'
import type { ServerMessage } from '@hip/protocol'

function fakeRunner(script: AIMsg[]): ModelRunner {
  let i = 0
  return {
    async run(_m: BaseMessage[], opts: ModelRunOptions): Promise<AIMsg> {
      const m = script[Math.min(i, script.length - 1)]; i++
      if (typeof m.content === 'string' && m.content) opts.onText(m.content)
      return m
    },
  }
}

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'hip-sess-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('Session agent loop', () => {
  it('writes the requested file and reports success (no phantom)', async () => {
    const runner = fakeRunner([
      new AIMessage({ content: '', tool_calls: [{ name: 'write_file', args: { path: '/intro.html', content: '<h1>hi</h1>' }, id: 'c1' }] }),
      new AIMessage('已创建 /intro.html，里面是一个简单的自我介绍页面。'),
    ])
    const session = new Session('s1', { llmProvider: 'deepseek', model: '', tools: [], cwd: root } as any, undefined, undefined, undefined, undefined, runner)
    const sent: ServerMessage[] = []
    await session.sendMessage('用一个 HTML 做个自我介绍', (m) => sent.push(m))

    expect(existsSync(join(root, 'intro.html'))).toBe(true)
    expect(readFileSync(join(root, 'intro.html'), 'utf8')).toBe('<h1>hi</h1>')

    const complete = sent.find((m) => m.type === 'message:complete') as Extract<ServerMessage, { type: 'message:complete' }>
    expect(complete.message.content).toContain('intro.html')
    expect(sent.some((m) => m.type === 'tool:started' && (m as any).name === 'write_file')).toBe(true)
  })
})
