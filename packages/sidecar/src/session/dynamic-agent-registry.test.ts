import { describe, it, expect } from 'vitest'
import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages'
import {
  DynamicAgentRegistry,
  runDynamicWorkflow,
  type CompiledAgent,
  type DynamicWorkflowDef,
} from './dynamic-agent-registry.js'
import { FakeAgentRunner } from '../orchestrator/ports.js'

function makeEchoAgent(prefix: string): CompiledAgent {
  return {
    name: prefix,
    async invoke({ messages }: { messages: BaseMessage[] }) {
      const last = messages[messages.length - 1]
      const incoming = typeof last?.content === 'string' ? last.content : String(last?.content ?? '')
      return { messages: [new AIMessage(`${prefix}:${incoming}`)] }
    },
  }
}

describe('DynamicAgentRegistry', () => {
  it('register → lookup returns agent', () => {
    const registry = new DynamicAgentRegistry()
    const agent = makeEchoAgent('alpha')

    registry.register('alpha', agent)

    expect(registry.lookup('alpha')).toBe(agent)
    expect(registry.list()).toEqual(['alpha'])
    expect(registry.activeCount).toBe(1)
  })

  it('unregister → lookup returns undefined', () => {
    const registry = new DynamicAgentRegistry()
    const agent = makeEchoAgent('alpha')
    registry.register('alpha', agent)

    registry.unregister('alpha')

    expect(registry.lookup('alpha')).toBeUndefined()
    expect(registry.list()).toEqual([])
    expect(registry.activeCount).toBe(0)
  })

  it('cap at 20 enforced (21st register → throws)', () => {
    const registry = new DynamicAgentRegistry(20)
    for (let i = 0; i < 20; i++) {
      registry.register(`agent-${i}`, makeEchoAgent(`agent-${i}`))
    }

    expect(registry.activeCount).toBe(20)
    expect(() => registry.register('agent-20', makeEchoAgent('agent-20'))).toThrow(/full/)
    expect(registry.activeCount).toBe(20)
  })
})

describe('runDynamicWorkflow', () => {
  it('dynamic workflow node → spawns agent from registry', async () => {
    const registry = new DynamicAgentRegistry()
    registry.register('solver', makeEchoAgent('solver'))
    const fallback = new FakeAgentRunner()
    const def: DynamicWorkflowDef = {
      id: 'wf',
      name: 'wf',
      nodes: [{ id: 'n1', dynamic: true, dynamicAgentName: 'solver', inputTemplate: '{{input}}' }],
      edges: [],
      entry: ['n1'],
    }

    const state = await runDynamicWorkflow(def, registry, fallback, {
      runId: 'r1',
      signal: new AbortController().signal,
      runInputs: { text: 'hello' },
    })

    expect(state.status).toBe('succeeded')
    expect(state.nodes.n1?.status).toBe('succeeded')
    expect(state.nodes.n1?.output?.text).toBe('solver:hello')
    expect(fallback.calls).toHaveLength(0)
  })

  it('unknown dynamic agent → node fails gracefully', async () => {
    const registry = new DynamicAgentRegistry()
    const fallback = new FakeAgentRunner()
    const def: DynamicWorkflowDef = {
      id: 'wf',
      name: 'wf',
      nodes: [{ id: 'n1', dynamic: true, dynamicAgentName: 'missing', inputTemplate: '{{input}}' }],
      edges: [],
      entry: ['n1'],
    }

    const state = await runDynamicWorkflow(def, registry, fallback, {
      runId: 'r2',
      signal: new AbortController().signal,
      runInputs: { text: 'task' },
    })

    expect(state.status).toBe('failed')
    expect(state.nodes.n1?.status).toBe('failed')
    expect(state.nodes.n1?.error).toBe('agent not registered')
  })

  it('static node (no dynamic flag) → uses agentId as before', async () => {
    const registry = new DynamicAgentRegistry()
    const fallback = new FakeAgentRunner({ n1: { text: 'static-result' } })
    const def: DynamicWorkflowDef = {
      id: 'wf',
      name: 'wf',
      nodes: [{ id: 'n1', agentId: 'worker', inputTemplate: '{{input}}' }],
      edges: [],
      entry: ['n1'],
    }

    const state = await runDynamicWorkflow(def, registry, fallback, {
      runId: 'r3',
      signal: new AbortController().signal,
      runInputs: { text: 'task' },
    })

    expect(state.status).toBe('succeeded')
    expect(state.nodes.n1?.status).toBe('succeeded')
    expect(state.nodes.n1?.output?.text).toBe('static-result')
    expect(fallback.calls).toHaveLength(1)
    expect(fallback.calls[0]?.agentId).toBe('worker')
    expect(fallback.calls[0]?.input.text).toBe('task')
  })
})
