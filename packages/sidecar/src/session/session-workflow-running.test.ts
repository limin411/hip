import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HumanMessage } from '@langchain/core/messages'
import type { WorkflowDef, ServerMessage } from '@hip/protocol'

const { runWorkflowTurnMock } = vi.hoisted(() => ({
  runWorkflowTurnMock: vi.fn(),
}))

vi.mock('./workflow-runner.js', () => ({
  runWorkflowTurn: (...args: unknown[]) => runWorkflowTurnMock(...args),
}))

// Import Session after the mock so it binds to the mocked runner.
import { Session } from './session.js'

const def: WorkflowDef = {
  id: 'wf-busy-test',
  name: 'Busy Test',
  entry: ['n1'],
  nodes: [{ type: 'agent', id: 'n1', agentId: 'worker', inputTemplate: 'do it' }],
  edges: [],
}

const cfg = { llmProvider: 'deepseek' as const, model: 'deepseek-chat', tools: [] as string[] }

describe('Session.runWorkflowTurn running lifecycle', () => {
  beforeEach(() => {
    runWorkflowTurnMock.mockReset()
  })

  it('sets running=true while a workflow turn is in flight and clears it after', async () => {
    let release!: (value: string) => void
    const gate = new Promise<string>((resolve) => {
      release = resolve
    })
    runWorkflowTurnMock.mockReturnValue(gate)

    const session = new Session('wf-running-lifecycle', cfg)
    const events: ServerMessage[] = []
    const send = (m: ServerMessage) => {
      events.push(m)
    }

    expect(session.running).toBe(false)

    const p = session.runWorkflowTurn(def, send)
    // Flush microtasks so the wrapper has entered try and set running.
    await Promise.resolve()
    expect(session.running).toBe(true)

    // Concurrent call must hit the in-method BUSY guard.
    const concurrent = await session.runWorkflowTurn(def, send)
    expect(concurrent).toBe('')
    expect(events.some((e) => e.type === 'error' && (e as { code?: string }).code === 'BUSY')).toBe(true)
    // First turn still holds the flag.
    expect(session.running).toBe(true)

    release!('done')
    const result = await p
    expect(result).toBe('done')
    expect(session.running).toBe(false)
  })

  it('clears running even when the workflow turn rejects', async () => {
    runWorkflowTurnMock.mockRejectedValue(new Error('workflow boom'))

    const session = new Session('wf-running-reject', cfg)

    await expect(session.runWorkflowTurn(def, () => {})).rejects.toThrow('workflow boom')
    expect(session.running).toBe(false)
  })
})

describe('runTurn DAG branch running lifecycle', () => {
  beforeEach(() => {
    runWorkflowTurnMock.mockReset()
  })

  it('sets running=true around runWorkflowTurnFn for orchMode=dag', async () => {
    let release!: (value: string) => void
    const gate = new Promise<string>((resolve) => {
      release = resolve
    })
    runWorkflowTurnMock.mockReturnValue(gate)

    const session = new Session('dag-running-lifecycle', { ...cfg, orchMode: 'dag' })
    // Seed a user message so extractLastUserText has content for runInputs.
    ;(session as unknown as { messages: HumanMessage[] }).messages.push(new HumanMessage('dag task'))

    expect(session.running).toBe(false)

    // Private runTurn → session-turn-runner runTurn DAG branch.
    const p = (session as unknown as {
      runTurn: (send: (m: ServerMessage) => void) => Promise<string>
    }).runTurn(() => {})

    await Promise.resolve()
    expect(session.running).toBe(true)
    expect(runWorkflowTurnMock).toHaveBeenCalledTimes(1)

    release!('dag-done')
    const result = await p
    expect(result).toBe('dag-done')
    expect(session.running).toBe(false)
  })
})
