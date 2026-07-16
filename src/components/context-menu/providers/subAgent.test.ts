import { describe, it, expect, vi } from 'vitest'
import type { TurnAgent } from '@/lib/turnAgents'
import { subAgentProvider } from './subAgent'
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
    copyText: vi.fn(async () => true),
    ...overrides,
  }
}

function agent(partial: Partial<TurnAgent> = {}): TurnAgent {
  return {
    agentId: 'worker-1',
    role: 'subagent',
    reasoning: '',
    tools: [],
    status: 'done',
    output: 'done result',
    elapsedMs: 10,
    taskInput: 'investigate bug',
    parentAgentId: 'supervisor',
    ...partial,
  }
}

function payload(partial: Partial<ContextPayloadMap['subAgent']> = {}): ContextPayloadMap['subAgent'] {
  return { agent: agent(), ...partial }
}

describe('subAgentProvider', () => {
  it('returns [] for other kinds', () => {
    expect(
      subAgentProvider(
        { kind: 'toolCall', payload: { tool: {} as never } },
        makeCtx(),
      ),
    ).toEqual([])
  })

  it('emits copy id / task / output', () => {
    const items = subAgentProvider({ kind: 'subAgent', payload: payload() }, makeCtx())
    expect(items.map((i) => i.id)).toEqual([
      'subAgent.copyId',
      'subAgent.copyTask',
      'subAgent.copyOutput',
    ])
  })

  it('copies agent id, task, and output', async () => {
    const copyText = vi.fn(async () => true)
    const items = subAgentProvider(
      { kind: 'subAgent', payload: payload() },
      makeCtx({ copyText }),
    )
    await items.find((i) => i.id === 'subAgent.copyId')!.run()
    await items.find((i) => i.id === 'subAgent.copyTask')!.run()
    await items.find((i) => i.id === 'subAgent.copyOutput')!.run()
    expect(copyText).toHaveBeenCalledWith('worker-1')
    expect(copyText).toHaveBeenCalledWith('investigate bug')
    expect(copyText).toHaveBeenCalledWith('done result')
  })

  it('disables task and output when empty', () => {
    const items = subAgentProvider(
      {
        kind: 'subAgent',
        payload: {
          agent: agent({ taskInput: undefined, output: '' }),
        },
      },
      makeCtx(),
    )
    expect(items.find((i) => i.id === 'subAgent.copyTask')?.disabled).toBe(true)
    expect(items.find((i) => i.id === 'subAgent.copyOutput')?.disabled).toBe(true)
    expect(items.find((i) => i.id === 'subAgent.copyId')?.disabled).toBeFalsy()
  })
})
