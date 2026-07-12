import { describe, it, expect, vi } from 'vitest'
import type { ToolCall } from '@hip/protocol'
import { toolCallProvider } from './toolCall'
import type { ContextMenuBuildContext, ContextPayloadMap } from '../types'

function makeCtx(overrides: Partial<ContextMenuBuildContext> = {}): ContextMenuBuildContext {
  return {
    t: ((key: string) => key) as ContextMenuBuildContext['t'],
    isMac: true,
    activeView: 'chat',
    surface: 'chat',
    activeSessionId: 's1',
    sessionStatus: 'idle',
    sessionInterrupt: false,
    openSessionIds: ['s1'],
    copyText: vi.fn(async () => true),
    ...overrides,
  }
}

function tool(partial: Partial<ToolCall> = {}): ToolCall {
  return {
    callId: 'c1',
    agentId: 'a1',
    name: 'read_file',
    input: '{"path":"src/main.ts"}',
    output: '{"content":"hello"}',
    status: 'finished',
    seq: 1,
    ...partial,
  }
}

function payload(partial: Partial<ContextPayloadMap['toolCall']> = {}): ContextPayloadMap['toolCall'] {
  return { tool: tool(), ...partial }
}

describe('toolCallProvider', () => {
  it('returns [] for other kinds', () => {
    expect(
      toolCallProvider(
        { kind: 'codeBlock', payload: { code: 'x' } },
        makeCtx(),
      ),
    ).toEqual([])
  })

  it('emits copy input / output / error', () => {
    const items = toolCallProvider({ kind: 'toolCall', payload: payload() }, makeCtx())
    expect(items.map((i) => i.id)).toEqual([
      'toolCall.copyInput',
      'toolCall.copyOutput',
      'toolCall.copyError',
    ])
  })

  it('copies input and output', async () => {
    const copyText = vi.fn(async () => true)
    const items = toolCallProvider(
      { kind: 'toolCall', payload: payload() },
      makeCtx({ copyText }),
    )
    await items.find((i) => i.id === 'toolCall.copyInput')!.run()
    await items.find((i) => i.id === 'toolCall.copyOutput')!.run()
    expect(copyText).toHaveBeenCalledWith('{"path":"src/main.ts"}')
    expect(copyText).toHaveBeenCalledWith('{"content":"hello"}')
  })

  it('disables output when missing; copies error when present', async () => {
    const copyText = vi.fn(async () => true)
    const items = toolCallProvider(
      {
        kind: 'toolCall',
        payload: {
          tool: tool({ status: 'error', output: undefined, error: 'boom' }),
        },
      },
      makeCtx({ copyText }),
    )
    expect(items.find((i) => i.id === 'toolCall.copyOutput')?.disabled).toBe(true)
    expect(items.find((i) => i.id === 'toolCall.copyError')?.disabled).toBe(false)
    await items.find((i) => i.id === 'toolCall.copyError')!.run()
    expect(copyText).toHaveBeenCalledWith('boom')
  })

  it('disables error when absent', () => {
    const items = toolCallProvider({ kind: 'toolCall', payload: payload() }, makeCtx())
    expect(items.find((i) => i.id === 'toolCall.copyError')?.disabled).toBe(true)
  })
})
