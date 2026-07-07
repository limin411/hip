import { describe, it, expect } from 'vitest'
import type { WorkflowDef, WorkflowNode, WorkflowEdge, NodeOutput } from '@hip/protocol'
import { initRunState, readyNodes, reduce, resolveInput } from './reduce.js'

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

const succeeded = (nodeId: string, output: NodeOutput = { text: '' }) =>
  ({ type: 'node:succeeded', nodeId, output }) as const

describe('initRunState', () => {
  it('入口 ready、其余 pending、run running', () => {
    const def = wf({
      nodes: [node('a'), node('b'), node('c')],
      edges: [{ from: 'a', to: 'b' } as WorkflowEdge],
      entry: ['a'],
    })
    const state = initRunState(def, 'run-1')
    expect(state.runId).toBe('run-1')
    expect(state.workflowId).toBe('wf')
    expect(state.status).toBe('running')
    expect(state.nodes.a.status).toBe('ready')
    expect(state.nodes.b.status).toBe('pending')
    expect(state.nodes.c.status).toBe('pending')
  })

  it('多入口都 ready', () => {
    const def = wf({ nodes: [node('a'), node('b')], entry: ['a', 'b'] })
    const state = initRunState(def, 'r')
    expect(state.nodes.a.status).toBe('ready')
    expect(state.nodes.b.status).toBe('ready')
  })
})

describe('reduce — 线性 a→b', () => {
  it('node:succeeded a 后 b 变 ready;readyNodes 返回 [b]', () => {
    const def = wf({
      nodes: [node('a'), node('b')],
      edges: [{ from: 'a', to: 'b' } as WorkflowEdge],
      entry: ['a'],
    })
    let state = initRunState(def, 'r')
    state = reduce(state, def, succeeded('a'))
    expect(state.nodes.a.status).toBe('succeeded')
    expect(state.nodes.b.status).toBe('ready')
    expect(readyNodes(state)).toEqual(['b'])
  })
})

describe('reduce — 扇出 a→b, a→c', () => {
  it('a 成功后 b、c 同时 ready', () => {
    const def = wf({
      nodes: [node('a'), node('b'), node('c')],
      edges: [
        { from: 'a', to: 'b' } as WorkflowEdge,
        { from: 'a', to: 'c' } as WorkflowEdge,
      ],
      entry: ['a'],
    })
    let state = initRunState(def, 'r')
    state = reduce(state, def, succeeded('a'))
    expect(state.nodes.b.status).toBe('ready')
    expect(state.nodes.c.status).toBe('ready')
    expect(readyNodes(state).sort()).toEqual(['b', 'c'])
  })
})

describe('reduce — 条件 a→b when contains "go"', () => {
  const def = wf({
    nodes: [node('a'), node('b')],
    edges: [{ from: 'a', to: 'b', when: { kind: 'contains', value: 'go' } } as WorkflowEdge],
    entry: ['a'],
  })

  it('产出含 "go" → b ready', () => {
    let state = initRunState(def, 'r')
    state = reduce(state, def, succeeded('a', { text: 'lets go now' }))
    expect(state.nodes.b.status).toBe('ready')
  })

  it('产出不含 "go" → b skipped', () => {
    let state = initRunState(def, 'r')
    state = reduce(state, def, succeeded('a', { text: 'stay here' }))
    expect(state.nodes.b.status).toBe('skipped')
  })
})

describe('reduce — join a→c, b→c', () => {
  const def = wf({
    nodes: [node('a'), node('b'), node('c')],
    edges: [
      { from: 'a', to: 'c' } as WorkflowEdge,
      { from: 'b', to: 'c' } as WorkflowEdge,
    ],
    entry: ['a', 'b'],
  })

  it('仅 a 成功(b 仍 pending)→ c 仍 pending', () => {
    let state = initRunState(def, 'r')
    state = reduce(state, def, succeeded('a'))
    expect(state.nodes.c.status).toBe('pending')
  })

  it('a、b 都成功 → c ready', () => {
    let state = initRunState(def, 'r')
    state = reduce(state, def, succeeded('a'))
    state = reduce(state, def, succeeded('b'))
    expect(state.nodes.c.status).toBe('ready')
  })

  it('两入边都 dead(都 skipped)→ c skipped(级联)', () => {
    let state = initRunState(def, 'r')
    state = reduce(state, def, { type: 'node:skipped', nodeId: 'a' })
    state = reduce(state, def, { type: 'node:skipped', nodeId: 'b' })
    expect(state.nodes.c.status).toBe('skipped')
  })
})

describe('reduce — fail-fast', () => {
  it('node:failed → run.status failed', () => {
    const def = wf({ nodes: [node('a')], entry: ['a'] })
    let state = initRunState(def, 'r')
    state = reduce(state, def, { type: 'node:failed', nodeId: 'a', error: 'boom' })
    expect(state.nodes.a.status).toBe('failed')
    expect(state.nodes.a.error).toBe('boom')
    expect(state.status).toBe('failed')
  })
})

describe('reduce — cancel', () => {
  it('run:cancelled → cascade: running/pending 节点都变为 cancelled', () => {
    const def = wf({
      nodes: [node('a'), node('b')],
      edges: [{ from: 'a', to: 'b' } as WorkflowEdge],
      entry: ['a'],
    })
    let state = initRunState(def, 'r')
    state = reduce(state, def, { type: 'node:started', nodeId: 'a' })
    expect(state.nodes.a.status).toBe('running')
    state = reduce(state, def, { type: 'run:cancelled' })
    expect(state.status).toBe('cancelled')
    expect(state.nodes.a.status).toBe('cancelled')
    expect(state.nodes.b.status).toBe('cancelled') // pending 也级联为 cancelled
  })
})

describe('reduce — run:started / run:finished', () => {
  it('run:finished 设置传入的 status', () => {
    const def = wf({ nodes: [node('a')], entry: ['a'] })
    let state = initRunState(def, 'r')
    state = reduce(state, def, { type: 'run:finished', status: 'succeeded' })
    expect(state.status).toBe('succeeded')
  })
})

describe('resolveInput', () => {
  const def = wf({ nodes: [node('a'), node('b', 'hi {{a}}')], entry: ['a'] })

  it("'hi {{a}}' + a.output.text='X' → 'hi X'", () => {
    let state = initRunState(def, 'r')
    state = reduce(state, def, succeeded('a', { text: 'X' }))
    const bNode = def.nodes.find((n) => n.id === 'b')!
    expect(resolveInput(bNode, state).text).toBe('hi X')
  })

  it("'{{input}}' 用 runInputs.text", () => {
    const n = node('x', '{{input}}')
    const state = initRunState(wf({ nodes: [n], entry: ['x'] }), 'r')
    expect(resolveInput(n, state, { text: 'RUN' }).text).toBe('RUN')
  })

  it("'{{input.k}}' 用 runInputs.data.k", () => {
    const n = node('x', '{{input.k}}')
    const state = initRunState(wf({ nodes: [n], entry: ['x'] }), 'r')
    expect(resolveInput(n, state, { text: '', data: { k: 'V' } }).text).toBe('V')
  })

  it('缺失引用 → 空字符串', () => {
    const n = node('x', 'a={{a}} in={{input}} ik={{input.k}}')
    const state = initRunState(wf({ nodes: [n], entry: ['x'] }), 'r')
    expect(resolveInput(n, state).text).toBe('a= in= ik=')
  })
})

describe('reduce with extended node types', () => {
  const makeDef = (nodes: WorkflowNode[]): WorkflowDef => ({
    id: 'test-wf',
    name: 'test',
    nodes,
    edges: [],
    entry: nodes.filter(n => n.type !== 'parallel').map(n => n.id),
  })

  it('ParallelNode with merge=all succeeds when all children succeed', () => {
    const def = makeDef([
      { type: 'parallel', id: 'p1', nodes: [
        { type: 'agent', id: 'a1', agentId: 'x', inputTemplate: '' },
        { type: 'agent', id: 'a2', agentId: 'x', inputTemplate: '' },
      ], mergeStrategy: 'all' },
    ])
    let state = initRunState(def, 'r1')

    state = reduce(state, def, { type: 'node:succeeded', nodeId: 'a1', output: { text: 'ok' } })
    state = reduce(state, def, { type: 'node:succeeded', nodeId: 'a2', output: { text: 'ok' } })
    expect(state.nodes['p1'].status).toBe('succeeded')
  })

  it('ParallelNode with merge=any resolves to succeeded when one succeeds (fail-fast cascades siblings)', () => {
    const def = makeDef([
      { type: 'parallel', id: 'p1', nodes: [
        { type: 'agent', id: 'a1', agentId: 'x', inputTemplate: '' },
        { type: 'agent', id: 'a2', agentId: 'x', inputTemplate: '' },
      ], mergeStrategy: 'any' },
    ])
    let state = initRunState(def, 'r1')

    state = reduce(state, def, { type: 'node:succeeded', nodeId: 'a1', output: { text: 'ok' } })
    // a2 失败触发 fail-fast cascade；但 p1 是 parallel 跳过 cascade，
    // 由 propagate 自底向上合并为 succeeded（any 策略：一个子节点成功足够）
    state = reduce(state, def, { type: 'node:failed', nodeId: 'a2', error: 'boom' })
    expect(state.nodes['p1'].status).toBe('succeeded')
    expect(state.status).toBe('failed') // 整个 run 仍是 failed
  })

  it('ParallelNode with merge=vote: propagate resolves to failed after fail-fast cascade', () => {
    const def = makeDef([
      { type: 'parallel', id: 'p1', nodes: [
        { type: 'agent', id: 'a1', agentId: 'x', inputTemplate: '' },
        { type: 'agent', id: 'a2', agentId: 'x', inputTemplate: '' },
        { type: 'agent', id: 'a3', agentId: 'x', inputTemplate: '' },
      ], mergeStrategy: 'vote' },
    ])
    let state = initRunState(def, 'r1')

    state = reduce(state, def, { type: 'node:succeeded', nodeId: 'a1', output: { text: 'ok' } })
    // a2 失败触发 fail-fast cascade；p1 是 parallel 跳过，a3 pending → skipped
    // propagate 随后将 p1 合并为 failed（1 succeed + 1 failed + 1 skipped，未过半数）
    state = reduce(state, def, { type: 'node:failed', nodeId: 'a2', error: 'boom' })
    expect(state.nodes['p1'].status).toBe('failed')
    expect(state.status).toBe('failed')
  })

  it('node:failed on any node triggers fail-fast for the run', () => {
    const def = makeDef([
      { type: 'agent', id: 'a1', agentId: 'x', inputTemplate: '' },
    ])
    let state = initRunState(def, 'r1')
    state = reduce(state, def, { type: 'run:started' })
    state = reduce(state, def, { type: 'node:started', nodeId: 'a1' })
    state = reduce(state, def, { type: 'node:failed', nodeId: 'a1', error: 'test error' })
    expect(state.status).toBe('failed')
    expect(state.nodes['a1'].status).toBe('failed')
    expect(state.nodes['a1'].error).toBe('test error')
  })

  it('run:cancelled marks all running nodes as cancelled', () => {
    const def = makeDef([
      { type: 'agent', id: 'a1', agentId: 'x', inputTemplate: '' },
      { type: 'agent', id: 'a2', agentId: 'x', inputTemplate: '' },
    ])
    let state = initRunState(def, 'r1')
    state = reduce(state, def, { type: 'run:started' })
    state.nodes['a1'] = { status: 'running' }
    state.nodes['a2'] = { status: 'running' }
    state = reduce(state, def, { type: 'run:cancelled' })
    expect(state.status).toBe('cancelled')
    expect(state.nodes['a1'].status).toBe('cancelled')
    expect(state.nodes['a2'].status).toBe('cancelled')
  })

  describe('edge cases', () => {
    it('ParallelNode with empty nodes resolves to failed', () => {
      const def: WorkflowDef = {
        id: 'test-wf', name: 'test',
        nodes: [
          node('trigger'),
          { type: 'parallel', id: 'p1', nodes: [], mergeStrategy: 'all' },
        ],
        edges: [],
        entry: ['trigger'],
      }
      let state = initRunState(def, 'r1')
      // trigger 成功后 propagate 运行，p1 空子节点 → failed
      state = reduce(state, def, succeeded('trigger'))
      expect(state.nodes['p1'].status).toBe('failed')
    })

    it('vote with exact tie (2/4 succeed) resolves to failed', () => {
      const def = makeDef([
        { type: 'parallel', id: 'p1', nodes: [
          { type: 'agent', id: 'a1', agentId: 'x', inputTemplate: '' },
          { type: 'agent', id: 'a2', agentId: 'x', inputTemplate: '' },
          { type: 'agent', id: 'a3', agentId: 'x', inputTemplate: '' },
          { type: 'agent', id: 'a4', agentId: 'x', inputTemplate: '' },
        ], mergeStrategy: 'vote' },
      ])
      let state = initRunState(def, 'r1')
      state = reduce(state, def, { type: 'node:succeeded', nodeId: 'a1', output: { text: 'ok' } })
      state = reduce(state, def, { type: 'node:succeeded', nodeId: 'a2', output: { text: 'ok' } })
      state = reduce(state, def, { type: 'node:failed', nodeId: 'a3', error: 'nope' })
      state = reduce(state, def, { type: 'node:failed', nodeId: 'a4', error: 'nope' })
      expect(state.nodes['p1'].status).toBe('failed')
    })

    it('vote with majority (3/4 succeed) resolves to succeeded', () => {
      const def = makeDef([
        { type: 'parallel', id: 'p1', nodes: [
          { type: 'agent', id: 'a1', agentId: 'x', inputTemplate: '' },
          { type: 'agent', id: 'a2', agentId: 'x', inputTemplate: '' },
          { type: 'agent', id: 'a3', agentId: 'x', inputTemplate: '' },
          { type: 'agent', id: 'a4', agentId: 'x', inputTemplate: '' },
        ], mergeStrategy: 'vote' },
      ])
      let state = initRunState(def, 'r1')
      state = reduce(state, def, { type: 'node:succeeded', nodeId: 'a1', output: { text: 'ok' } })
      state = reduce(state, def, { type: 'node:succeeded', nodeId: 'a2', output: { text: 'ok' } })
      state = reduce(state, def, { type: 'node:succeeded', nodeId: 'a3', output: { text: 'ok' } })
      state = reduce(state, def, { type: 'node:failed', nodeId: 'a4', error: 'nope' })
      expect(state.nodes['p1'].status).toBe('succeeded')
    })

    it('ParallelNode with single child resolves correctly', () => {
      const def = makeDef([
        { type: 'parallel', id: 'p1', nodes: [
          { type: 'agent', id: 'a1', agentId: 'x', inputTemplate: '' },
        ], mergeStrategy: 'all' },
      ])
      let state = initRunState(def, 'r1')
      state = reduce(state, def, { type: 'node:succeeded', nodeId: 'a1', output: { text: 'ok' } })
      expect(state.nodes['p1'].status).toBe('succeeded')
    })

    it('unknown merge strategy resolves to failed', () => {
      const def = makeDef([
        { type: 'parallel', id: 'p1', nodes: [
          { type: 'agent', id: 'a1', agentId: 'x', inputTemplate: '' },
        ], mergeStrategy: 'unknown' as any },
      ])
      let state = initRunState(def, 'r1')
      state = reduce(state, def, { type: 'node:succeeded', nodeId: 'a1', output: { text: 'ok' } })
      expect(state.nodes['p1'].status).toBe('failed')
    })
  })
})
