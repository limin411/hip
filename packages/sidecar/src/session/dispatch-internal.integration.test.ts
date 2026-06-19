import { describe, it, expect, afterEach } from 'vitest'
import type { AgentConfig, ServerMessage } from '@hip/protocol'
import { createAgentInvoker } from './agents/invoker.js'
import { runManagedAgent } from './internal-runner.js'
import {
  makeToolCallingModel, registerAgent, cleanupAgents, collect, makeTextRunner, makeSessionWithInvokerFactory,
} from './__testutils__/dispatch-harness.js'

afterEach(() => cleanupAgents())

const internalAgent: AgentConfig = {
  id: 'reviewer', name: 'Reviewer', kind: 'internal', command: '', args: [],
  enabled: true, prompt: 'You review code.', allowedTools: ['read_file', 'grep'],
}

describe('dispatch -> internal managed agent (end-to-end)', () => {
  it('runs the internal agent on the built-in loop and streams a nested sub-agent run', async () => {
    registerAgent(internalAgent)

    const supervisorModel = makeToolCallingModel(
      { agent: 'reviewer', task: 'review /a.ts' },
      'The reviewer said: looks good.',
    )

    // Real invoker, but the internal child uses a FAKE model (paid-free) on the REAL loop.
    const invokerFactory = (cwd: string) => createAgentInvoker(cwd, {
      runInternal: (a) => runManagedAgent({
        resolved: a.resolved, cwd: a.cwd, prompt: a.prompt,
        task: a.task, emit: a.emit, signal: a.signal, childMaxSteps: 5,
        runner: makeTextRunner('looks good'),
        summarizer: { async summarize() { return '' } },
      }),
    })

    const session = makeSessionWithInvokerFactory('s-internal', supervisorModel, invokerFactory)
    const msgs = await collect(session, 'please review')

    // A nested sub-agent run was surfaced (role 'subagent', parent 'supervisor').
    const started = msgs.find((m) => m.type === 'agent:started' && (m as { role?: string }).role === 'subagent') as
      | (ServerMessage & { agentId: string; parentAgentId?: string })
      | undefined
    expect(started).toBeTruthy()
    expect(started!.parentAgentId).toBe('supervisor')
    expect(msgs.some((m) => m.type === 'agent:finished' && (m as { agentId?: string }).agentId === started!.agentId)).toBe(true)

    // The child streamed its result text through the nested emit.
    const childText = msgs
      .filter((m) => m.type === 'token:stream' && (m as { agentId?: string }).agentId === started!.agentId)
      .map((m) => (m as { delta: string }).delta)
      .join('')
    expect(childText).toContain('looks good')

    // The supervisor produced its final answer.
    const supervisorText = msgs
      .filter((m) => m.type === 'token:stream' && (m as { agentId?: string }).agentId === 'supervisor')
      .map((m) => (m as { delta: string }).delta)
      .join('')
    expect(supervisorText).toContain('The reviewer said: looks good.')
  })
})
