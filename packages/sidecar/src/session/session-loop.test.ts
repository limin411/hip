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

  it('pauses on a doom loop, emits agent:interrupt, then resumes to completion', async () => {
    const tc = () => new AIMessage({ content: '', tool_calls: [{ name: 'ls', args: { path: '/' }, id: 'x' }] })
    const runner = fakeRunner([tc(), tc(), tc(), tc(), new AIMessage('好的，我换个方法完成了任务。')])
    const session = new Session('s2', { llmProvider: 'deepseek', model: '', tools: [], cwd: root } as any, undefined, undefined, undefined, undefined, runner)

    const sent: ServerMessage[] = []
    await session.sendMessage('一直 ls 根目录', (m) => sent.push(m))

    const interrupt = sent.find((m) => m.type === 'agent:interrupt') as Extract<ServerMessage, { type: 'agent:interrupt' }>
    expect(interrupt).toBeTruthy()
    expect(interrupt.question).toBeTruthy()
    const firstComplete = sent.find((m) => m.type === 'message:complete') as Extract<ServerMessage, { type: 'message:complete' }>
    expect(firstComplete.message.stopped).toBe(true)

    const sent2: ServerMessage[] = []
    await session.resume('改用直接写文件', (m) => sent2.push(m))
    const done = sent2.find((m) => m.type === 'message:complete') as Extract<ServerMessage, { type: 'message:complete' }>
    expect(done.message.content).toContain('换个方法完成了')
  })

  it('cancel while awaiting resume clears the pause (next send is a fresh turn)', async () => {
    const tc = () => new AIMessage({ content: '', tool_calls: [{ name: 'ls', args: { path: '/' }, id: 'x' }] })
    const runner = fakeRunner([tc(), tc(), tc(), tc(), new AIMessage('已直接回答。')])
    const session = new Session('s3', { llmProvider: 'deepseek', model: '', tools: [], cwd: root } as any, undefined, undefined, undefined, undefined, runner)
    await session.sendMessage('一直 ls', () => {})
    session.cancel()
    const sent: ServerMessage[] = []
    await session.sendMessage('换个问题', (m) => sent.push(m))
    expect(sent.some((m) => m.type === 'message:complete')).toBe(true)
  })
})
