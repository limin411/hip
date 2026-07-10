/**
 * Sprint A — cancel mid-turn must still emit message:complete with stopped note.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AIMessage, type AIMessage as AIMsg, type BaseMessage } from '@langchain/core/messages'
import { Session } from '../session.js'
import type { ModelRunner, ModelRunOptions } from '../model-runner.js'
import type { ServerMessage } from '@hip/protocol'

function gateRunner(onFirst: () => Promise<void>): ModelRunner {
  let calls = 0
  return {
    async run(_m: BaseMessage[], opts: ModelRunOptions): Promise<AIMsg> {
      calls++
      if (calls === 1) {
        opts.onText?.('Working on it…')
        await onFirst()
        // After gate: if aborted, LangGraph/session may throw; still return something.
        return new AIMessage({
          content: '',
          tool_calls: [{ name: 'ls', args: { path: '/' }, id: 'c1' }],
        })
      }
      return new AIMessage('done')
    },
  }
}

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'hip-cancel-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('cancel projection (A1)', () => {
  it('finalize stopped message when abort has streamed supervisor text', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const runner = gateRunner(async () => {
      // Hold the first model call open until cancel is requested.
      await gate
    })
    const session = new Session(
      'cancel-proj',
      { llmProvider: 'deepseek', model: '', tools: [], cwd: root } as never,
      undefined,
      undefined,
      undefined,
      undefined,
      runner,
    )
    const sent: ServerMessage[] = []
    const p = session.sendMessage('please work', (m) => sent.push(m))
    // Wait until streaming token arrives
    await vi.waitFor(() => {
      expect(sent.some((m) => m.type === 'token:stream')).toBe(true)
    })
    session.cancel()
    release()
    await p

    const complete = sent.find((m) => m.type === 'message:complete') as
      | Extract<ServerMessage, { type: 'message:complete' }>
      | undefined
    expect(complete).toBeTruthy()
    expect(complete!.message.stopped).toBe(true)
    expect(complete!.message.content.length).toBeGreaterThan(0)
    expect(complete!.message.content).toMatch(/cancelled|Working/i)
  })
})
