import { describe, it, expect } from 'vitest'
import type { WorkflowDef, WorkflowNode, WorkflowEdge } from '@hip/protocol'
import { runWorkflow } from './executor.js'
import { FakeAgentRunner, CollectingEventSink, type FakeScript } from './ports.js'

const node = (id: string, inputTemplate = ''): WorkflowNode => ({
  id,
  type: 'agent',
  agentId: 'a',
  inputTemplate,
})

const wf = (over: Partial<WorkflowDef>): WorkflowDef => ({
  id: 'wf',
  name: 'wf',
  nodes: [],
  edges: [],
  entry: [],
  ...over,
})

const harness = (script: FakeScript = {}) => {
  const runner = new FakeAgentRunner(script)
  const sink = new CollectingEventSink()
  return { runner, sink, ports: { agentRunner: runner, eventSink: sink } }
}

describe('runWorkflow — 线性 a→b', () => {
  it('两节点 succeeded;事件序正确;a 在 b 前;b 收到 a 的产出', async () => {
    const def = wf({
      nodes: [node('a'), node('b', '{{a}}')],
      edges: [{ from: 'a', to: 'b' } as WorkflowEdge],
      entry: ['a'],
    })
    const { runner, sink, ports } = harness({ a: { text: 'X' } })
    const ac = new AbortController()
    const state = await runWorkflow(def, ports, { runId: 'r1', signal: ac.signal })

    expect(state.status).toBe('succeeded')
    expect(state.nodes.a.status).toBe('succeeded')
    expect(state.nodes.b.status).toBe('succeeded')

    expect(sink.events.map((e) => e.type)).toEqual([
      'run:started',
      'node:started',
      'node:succeeded',
      'node:started',
      'node:succeeded',
      'run:finished',
    ])
    const finished = sink.ofType('run:finished')
    expect(finished).toHaveLength(1)
    expect(finished[0].status).toBe('succeeded')

    // a 在 b 之前被调用
    expect(runner.calls.map((c) => c.nodeId)).toEqual(['a', 'b'])
    // b 的 input.text 含 a 的产出 'X'(inputTemplate '{{a}}')
    const bCall = runner.calls.find((c) => c.nodeId === 'b')!
    expect(bCall.input.text).toBe('X')
  })
})

describe('runWorkflow — 并行扇出 a→b, a→c', () => {
  it('a 后 b、c 都被调用;run succeeded', async () => {
    const def = wf({
      nodes: [node('a'), node('b'), node('c')],
      edges: [
        { from: 'a', to: 'b' } as WorkflowEdge,
        { from: 'a', to: 'c' } as WorkflowEdge,
      ],
      entry: ['a'],
    })
    const { runner, ports } = harness()
    const ac = new AbortController()
    const state = await runWorkflow(def, ports, { runId: 'r2', signal: ac.signal })

    expect(state.status).toBe('succeeded')
    expect(state.nodes.b.status).toBe('succeeded')
    expect(state.nodes.c.status).toBe('succeeded')
    const called = runner.calls.map((c) => c.nodeId)
    expect(called).toContain('a')
    expect(called).toContain('b')
    expect(called).toContain('c')
    // a 必在 b、c 之前
    expect(called.indexOf('a')).toBeLessThan(called.indexOf('b'))
    expect(called.indexOf('a')).toBeLessThan(called.indexOf('c'))
  })
})

describe('runWorkflow — 条件跳过 a→b when contains "go"', () => {
  it('a 产出 "stop" → b 不被调用、b skipped、run succeeded', async () => {
    const def = wf({
      nodes: [node('a'), node('b')],
      edges: [{ from: 'a', to: 'b', when: { kind: 'contains', value: 'go' } } as WorkflowEdge],
      entry: ['a'],
    })
    const { runner, ports } = harness({ a: { text: 'stop' } })
    const ac = new AbortController()
    const state = await runWorkflow(def, ports, { runId: 'r3', signal: ac.signal })

    expect(state.status).toBe('succeeded')
    expect(state.nodes.b.status).toBe('skipped')
    expect(runner.calls.map((c) => c.nodeId)).not.toContain('b')
  })
})

describe('runWorkflow — 失败 fail-fast', () => {
  it('b throws → run failed,有 node:failed 事件', async () => {
    const def = wf({
      nodes: [node('a'), node('b')],
      edges: [{ from: 'a', to: 'b' } as WorkflowEdge],
      entry: ['a'],
    })
    const { sink, ports } = harness({ b: { throws: 'boom' } })
    const ac = new AbortController()
    const state = await runWorkflow(def, ports, { runId: 'r4', signal: ac.signal })

    expect(state.status).toBe('failed')
    expect(state.nodes.b.status).toBe('failed')
    expect(state.nodes.b.error).toBe('boom')
    const failed = sink.ofType('node:failed')
    expect(failed).toHaveLength(1)
    expect(failed[0].nodeId).toBe('b')
    expect(failed[0].error).toBe('boom')
  })
})

describe('runWorkflow — 取消', () => {
  it('在飞节点 delayMs:200,启动后 ~50ms abort → run cancelled,无 run:finished(succeeded)', async () => {
    const def = wf({
      nodes: [node('a')],
      entry: ['a'],
    })
    const { sink, ports } = harness({ a: { delayMs: 200 } })
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 50)
    const state = await runWorkflow(def, ports, { runId: 'r5', signal: ac.signal })

    expect(state.status).toBe('cancelled')
    // 没有任何 run:finished 携带 'succeeded'
    expect(sink.ofType('run:finished').some((e) => e.status === 'succeeded')).toBe(false)
    // 收到了取消事件
    expect(sink.ofType('run:cancelled').length).toBeGreaterThanOrEqual(1)
  })
})
