import { describe, it, expect } from 'vitest'
import type { WorkflowDef, RunState, OrchestratorEvent, AgentDescriptor } from './index.js'

describe('orchestration types', () => {
  it('WorkflowDef 过 JSON 保留节点/边/入口', () => {
    const def: WorkflowDef = { id: 'w', name: 'W', entry: ['a'],
      nodes: [{ id: 'a', type: 'agent', agentId: 'mock', inputTemplate: '{{input}}' },
              { id: 'b', type: 'agent', agentId: 'mock', inputTemplate: 'use {{a}}' }],
      edges: [{ from: 'a', to: 'b', when: { kind: 'contains', value: 'ok' } }] }
    const rt = JSON.parse(JSON.stringify(def)) as WorkflowDef
    const nodeB = rt.nodes[1]
    expect(nodeB.type === 'agent' ? nodeB.inputTemplate : undefined).toBe('use {{a}}')
    expect(rt.edges[0].when?.kind).toBe('contains')
    expect(rt.entry).toEqual(['a'])
  })
  it('RunState + 事件判别式存活', () => {
    const s: RunState = { runId: 'r', workflowId: 'w', status: 'running', nodes: { a: { status: 'succeeded', output: { text: 'hi' } } } }
    expect(JSON.parse(JSON.stringify(s)).nodes.a.output.text).toBe('hi')
    const e: OrchestratorEvent = { type: 'node:failed', nodeId: 'a', error: 'boom' }
    expect((JSON.parse(JSON.stringify(e)) as Extract<OrchestratorEvent, { type: 'node:failed' }>).error).toBe('boom')
  })
  it('AgentDescriptor.capabilities 四字段', () => {
    const d: AgentDescriptor = { id: 'm', name: 'M', kind: 'acp', capabilities: { streamsReasoning: true, toolCalls: true, hitl: true, modelSwitch: true } }
    expect(d.capabilities.hitl).toBe(true)
  })
})

describe('OrchestrationMode', () => {
  it('accepts "fast"', () => {
    const mode: import('./orchestration-types.js').OrchestrationMode = 'fast'
    expect(mode).toBe('fast')
  })

  it('accepts "dag"', () => {
    const mode: import('./orchestration-types.js').OrchestrationMode = 'dag'
    expect(mode).toBe('dag')
  })
})

describe('WorkflowNode', () => {
  it('ToolNode has correct shape', () => {
    const node: import('./orchestration-types.js').ToolNode = {
      type: 'tool',
      id: 'n1',
      toolName: 'read_file',
      inputTemplate: '{{input}}',
    }
    expect(node.type).toBe('tool')
  })

  it('ParallelNode with vote merge', () => {
    const node: import('./orchestration-types.js').ParallelNode = {
      type: 'parallel',
      id: 'n1',
      nodes: [],
      mergeStrategy: 'vote',
    }
    expect(node.mergeStrategy).toBe('vote')
  })

  it('GateNode with lint config', () => {
    const node: import('./orchestration-types.js').GateNode = {
      type: 'gate',
      id: 'n1',
      gateKind: 'lint',
      config: { command: 'eslint .' },
    }
    expect(node.gateKind).toBe('lint')
  })

  it('HumanNode with timeout', () => {
    const node: import('./orchestration-types.js').HumanNode = {
      type: 'human',
      id: 'n1',
      question: 'Approve changes?',
      timeoutMs: 30000,
    }
    expect(node.timeoutMs).toBe(30000)
  })
})
