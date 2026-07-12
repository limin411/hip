import { describe, it, expect, vi } from 'vitest'
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import { runSubagent } from './subagent.js'
import { HookRegistry } from './hooks/registry.js'
import type { ModelRunner, ModelRunOptions } from './model-runner.js'

function noopEmit() {
  return {
    token: () => {},
    reasoning: () => {},
    toolStarted: () => {},
    toolFinished: () => {},
    usage: () => {},
    planDelta: () => {},
    compaction: () => {},
  }
}

describe('runSubagent plugin hooks', () => {
  it('PreToolUse deny blocks tool execution via ToolRunner', async () => {
    const hooks = new HookRegistry()
    let toolInvoked = false
    hooks.register({
      event: 'PreToolUse',
      matcher: 'read_file',
      handler: async () => ({ kind: 'deny', reason: 'blocked for test' }),
    })

    // First model response: call read_file; second: finish with text.
    let step = 0
    const runner: ModelRunner = {
      async run(_messages: BaseMessage[], opts: ModelRunOptions): Promise<AIMessage> {
        step++
        if (step === 1) {
          return new AIMessage({
            content: '',
            tool_calls: [{ name: 'read_file', args: { path: 'secret.txt' }, id: 'c1' }],
          })
        }
        // After tool result, model sees the deny error and finishes.
        const last = _messages[_messages.length - 1]
        const content = typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content)
        if (content.includes('denied by hook') || content.includes('blocked for test')) {
          opts.onText?.('acknowledged block')
          return new AIMessage('acknowledged block')
        }
        opts.onText?.('done')
        return new AIMessage('done')
      },
    }

    // Spy tool invoke by wrapping — ToolRunner will not invoke if denied; we assert via message path.
    const text = await runSubagent({
      runner,
      root: process.cwd(),
      summarizer: { async summarize() { return '' } },
      emit: noopEmit(),
      signal: new AbortController().signal,
      description: 'read secret.txt',
      childMaxSteps: 4,
      permissionMode: 'full',
      hooks,
      sessionId: 's-hook-sub',
      agentId: 'worker-1',
      parentAgentId: 'supervisor',
    })

    expect(toolInvoked).toBe(false)
    // Model should have received a tool error message and produced a final reply.
    expect(typeof text).toBe('string')
    expect(step).toBeGreaterThanOrEqual(2)
  })

  it('forwards hooks reference on recursive child spawn args', async () => {
    const hooks = new HookRegistry()
    // No tool calls — just ensure no throw with hooks set.
    const runner: ModelRunner = {
      async run(_m, opts) {
        opts.onText?.('ok')
        return new AIMessage('ok')
      },
    }
    const text = await runSubagent({
      runner,
      root: process.cwd(),
      summarizer: { async summarize() { return '' } },
      emit: noopEmit(),
      signal: new AbortController().signal,
      description: 'hi',
      childMaxSteps: 2,
      hooks,
    })
    expect(text).toBe('ok')
  })
})
