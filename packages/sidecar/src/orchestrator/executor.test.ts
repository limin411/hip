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

describe('runWorkflow — gate node on main path', () => {
  it('runs a gate node after an agent and fails the run when the gate fails', async () => {
    const { registerGate } = await import('./gates/index.js')
    registerGate({
      kind: 'unit-fail-gate',
      description: 'always fail',
      async run() {
        return {
          passed: false,
          failures: [{ message: 'type error', severity: 'error' }],
          suggestions: [],
          durationMs: 1,
        }
      },
    })
    const def: WorkflowDef = {
      id: 'wg',
      name: 'with-gate',
      entry: ['a'],
      nodes: [
        { type: 'agent', id: 'a', agentId: 'w', inputTemplate: '{{input}}' },
        { type: 'gate', id: 'g', gateKind: 'unit-fail-gate' },
      ],
      edges: [{ from: 'a', to: 'g' }],
    }
    const { ports } = harness({ a: { text: 'done' } })
    const ac = new AbortController()
    const state = await runWorkflow(def, ports, { runId: 'rg', signal: ac.signal, cwd: process.cwd() })
    expect(state.nodes['a'].status).toBe('succeeded')
    expect(state.nodes['g'].status).toBe('failed')
    expect(state.status).toBe('failed')
  })

  it('passes the run when the gate passes', async () => {
    const { registerGate } = await import('./gates/index.js')
    registerGate({
      kind: 'unit-pass-gate',
      description: 'always pass',
      async run() {
        return { passed: true, failures: [], suggestions: [], durationMs: 1 }
      },
    })
    const def: WorkflowDef = {
      id: 'wg2',
      name: 'with-gate-pass',
      entry: ['a'],
      nodes: [
        { type: 'agent', id: 'a', agentId: 'w', inputTemplate: 'x' },
        { type: 'gate', id: 'g', gateKind: 'unit-pass-gate' },
      ],
      edges: [{ from: 'a', to: 'g' }],
    }
    const { ports } = harness({ a: { text: 'ok' } })
    const ac = new AbortController()
    const state = await runWorkflow(def, ports, { runId: 'rg2', signal: ac.signal })
    expect(state.nodes['g'].status).toBe('succeeded')
    expect(state.status).toBe('succeeded')
  })
})

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

  it('propagate 级联出的 skip 也进事件流(node:skipped 被发射,供 WS 透传)', async () => {
    // a 不满足条件 → b skip;b→c 无条件,b 既已 skip,c 也级联 skip。
    const def = wf({
      nodes: [node('a'), node('b'), node('c')],
      edges: [
        { from: 'a', to: 'b', when: { kind: 'contains', value: 'go' } } as WorkflowEdge,
        { from: 'b', to: 'c' } as WorkflowEdge,
      ],
      entry: ['a'],
    })
    const { runner, sink, ports } = harness({ a: { text: 'stop' } })
    const ac = new AbortController()
    const state = await runWorkflow(def, ports, { runId: 'r6', signal: ac.signal })

    expect(state.status).toBe('succeeded')
    expect(state.nodes.b.status).toBe('skipped')
    expect(state.nodes.c.status).toBe('skipped')
    expect(runner.calls.map((c) => c.nodeId)).not.toContain('b')
    expect(runner.calls.map((c) => c.nodeId)).not.toContain('c')
    // 仅凭事件流重建状态的下游也能看到这两处 skip 转移
    const skipped = sink.ofType('node:skipped').map((e) => e.nodeId)
    expect(skipped).toContain('b')
    expect(skipped).toContain('c')
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

  it('并发失败:扇出 a→b, a→c 且 b、c 都抛 → 终态无节点滞留 running', async () => {
    // 回归:首个失败把 run.status 置 'failed';第二个在飞节点的拒绝若被吞,
    // 其 NodeRunState 会永久停在 'running' —— 终态快照(status='failed' 却有 running 节点)自相矛盾。
    const def = wf({
      nodes: [node('a'), node('b'), node('c')],
      edges: [
        { from: 'a', to: 'b' } as WorkflowEdge,
        { from: 'a', to: 'c' } as WorkflowEdge,
      ],
      entry: ['a'],
    })
    const { sink, ports } = harness({ b: { throws: 'boom-b' }, c: { throws: 'boom-c' } })
    const ac = new AbortController()
    const state = await runWorkflow(def, ports, { runId: 'r8', signal: ac.signal })

    expect(state.status).toBe('failed')
    // 关键不变量:终态快照里没有任何节点仍停在 'running'。
    const lingering = Object.entries(state.nodes).filter(([, s]) => s.status === 'running')
    expect(lingering).toEqual([])
    // 两个并发失败的兄弟节点都落定为 failed(而非一个被吞)。
    expect(state.nodes.b.status).toBe('failed')
    expect(state.nodes.c.status).toBe('failed')
    // 两条 node:failed 事件都进了事件流,下游(WS 透传)可据此离开 running。
    const failed = sink.ofType('node:failed').map((e) => e.nodeId)
    expect(failed).toContain('b')
    expect(failed).toContain('c')
  })
})

describe('runWorkflow — 并发上限 maxConcurrency', () => {
  it('maxConcurrency:1 时扇出 a→b,a→c,a→d,a→e 串行执行,调用序为 a,b,c,d,e', async () => {
    const def = wf({
      nodes: [node('a'), node('b'), node('c'), node('d'), node('e')],
      edges: [
        { from: 'a', to: 'b' } as WorkflowEdge,
        { from: 'a', to: 'c' } as WorkflowEdge,
        { from: 'a', to: 'd' } as WorkflowEdge,
        { from: 'a', to: 'e' } as WorkflowEdge,
      ],
      entry: ['a'],
    })
    const { runner, ports } = harness()
    const ac = new AbortController()
    const state = await runWorkflow(def, ports, { runId: 'r9', signal: ac.signal, maxConcurrency: 1 })

    expect(state.status).toBe('succeeded')
    expect(runner.calls.map((c) => c.nodeId)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('maxConcurrency:2 时扇出 4 个节点全部成功完成', async () => {
    const def = wf({
      nodes: [node('a'), node('b'), node('c'), node('d'), node('e')],
      edges: [
        { from: 'a', to: 'b' } as WorkflowEdge,
        { from: 'a', to: 'c' } as WorkflowEdge,
        { from: 'a', to: 'd' } as WorkflowEdge,
        { from: 'a', to: 'e' } as WorkflowEdge,
      ],
      entry: ['a'],
    })
    const { ports } = harness()
    const ac = new AbortController()
    const state = await runWorkflow(def, ports, { runId: 'r10', signal: ac.signal, maxConcurrency: 2 })

    expect(state.status).toBe('succeeded')
    expect(state.nodes.b.status).toBe('succeeded')
    expect(state.nodes.c.status).toBe('succeeded')
    expect(state.nodes.d.status).toBe('succeeded')
    expect(state.nodes.e.status).toBe('succeeded')
    expect(Object.values(state.nodes).every((n) => n.status !== 'running')).toBe(true)
  })

  it('默认 maxConcurrency(5)下 6 个扇出节点全部成功完成', async () => {
    const nodes = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => node(id))
    const def = wf({
      nodes,
      edges: [
        { from: 'a', to: 'b' } as WorkflowEdge,
        { from: 'a', to: 'c' } as WorkflowEdge,
        { from: 'a', to: 'd' } as WorkflowEdge,
        { from: 'a', to: 'e' } as WorkflowEdge,
        { from: 'a', to: 'f' } as WorkflowEdge,
        { from: 'a', to: 'g' } as WorkflowEdge,
      ],
      entry: ['a'],
    })
    const { ports } = harness()
    const ac = new AbortController()
    const state = await runWorkflow(def, ports, { runId: 'r11', signal: ac.signal })

    expect(state.status).toBe('succeeded')
    expect(Object.values(state.nodes).every((n) => n.status === 'succeeded')).toBe(true)
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

  it('启动即被取消(launch 前 signal 已 aborted)→ run cancelled,无 succeeded,有 run:cancelled', async () => {
    const def = wf({
      nodes: [node('a')],
      entry: ['a'],
    })
    const { runner, sink, ports } = harness({ a: { text: 'X' } })
    const ac = new AbortController()
    ac.abort() // launch() 之前就已取消:inFlight 永远为空,while 整体不进入
    const state = await runWorkflow(def, ports, { runId: 'r7', signal: ac.signal })

    expect(state.status).toBe('cancelled')
    // 早返回的 launch 没派发任何节点
    expect(runner.calls).toHaveLength(0)
    // 绝不误报成功
    expect(sink.ofType('run:finished').some((e) => e.status === 'succeeded')).toBe(false)
    // 取消契约:必有 run:cancelled
    expect(sink.ofType('run:cancelled').length).toBeGreaterThanOrEqual(1)
  })
})

describe('runWorkflow — C-validate tool/human reject', () => {
  it('rejects tool node before run starts (no run:started, no agent calls)', async () => {
    const def = wf({
      nodes: [
        node('a'),
        { type: 'tool', id: 't1', toolName: 'read_file', inputTemplate: '{{input}}' },
      ],
      edges: [{ from: 'a', to: 't1' } as WorkflowEdge],
      entry: ['a'],
    })
    const { runner, sink, ports } = harness({ a: { text: 'ok' } })
    const ac = new AbortController()
    await expect(runWorkflow(def, ports, { runId: 'r-tool', signal: ac.signal })).rejects.toThrow(
      /Invalid workflow|tool/,
    )
    expect(runner.calls).toHaveLength(0)
    expect(sink.ofType('run:started')).toHaveLength(0)
  })

  it('rejects human node before run starts', async () => {
    const def = wf({
      nodes: [
        node('a'),
        { type: 'human', id: 'h1', question: 'Approve?' },
      ],
      edges: [{ from: 'a', to: 'h1' } as WorkflowEdge],
      entry: ['a'],
    })
    const { runner, sink, ports } = harness({ a: { text: 'ok' } })
    const ac = new AbortController()
    await expect(runWorkflow(def, ports, { runId: 'r-human', signal: ac.signal })).rejects.toThrow(
      /Invalid workflow|human/,
    )
    expect(runner.calls).toHaveLength(0)
    expect(sink.ofType('run:started')).toHaveLength(0)
  })
})
