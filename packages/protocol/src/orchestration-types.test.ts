import { describe, it, expect } from 'vitest'
import type { WorkflowDef, RunState, OrchestratorEvent, AgentDescriptor } from './index.js'

describe('orchestration types', () => {
  it('WorkflowDef 过 JSON 保留节点/边/入口', () => {
    const def: WorkflowDef = { id: 'w', name: 'W', entry: ['a'],
      nodes: [{ id: 'a', type: 'agent', agentId: 'mock', inputTemplate: '{{input}}' },
              { id: 'b', type: 'agent', agentId: 'mock', inputTemplate: 'use {{a}}' }],
      edges: [{ from: 'a', to: 'b', when: { kind: 'contains', value: 'ok' } }] }
    const rt = JSON.parse(JSON.stringify(def)) as WorkflowDef
    expect(rt.nodes[1].inputTemplate).toBe('use {{a}}')
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
