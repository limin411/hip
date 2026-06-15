import { describe, it, expect } from 'vitest'
import type { AgentConfig, WorkflowDef, WorkflowNode, WorkflowEdge } from '@hip/protocol'
import { buildRegistry } from './registry.js'
import { validateWorkflow, type ValidationCode } from './validate.js'

// 只含 'a' 的 registry,供节点引用合法/非法 agent。
const regA = buildRegistry([{ id: 'a', name: 'A', kind: 'custom', enabled: true } as AgentConfig])

const node = (id: string, agentId: string, inputTemplate = ''): WorkflowNode => ({
  id,
  type: 'agent',
  agentId,
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

const codes = (errs: { code: ValidationCode }[]) => errs.map((e) => e.code)

describe('validateWorkflow', () => {
  it('合法链 a→b(b 引用 {{a}})+ a 入口 → []', () => {
    const def = wf({
      nodes: [node('a', 'a'), node('b', 'a', 'hi {{a}}')],
      edges: [{ from: 'a', to: 'b' } as WorkflowEdge],
      entry: ['a'],
    })
    expect(validateWorkflow(def, regA)).toEqual([])
  })

  it('未注册 agent → unknown-agent', () => {
    const def = wf({
      nodes: [node('a', 'a'), node('g', 'ghost')],
      edges: [{ from: 'a', to: 'g' } as WorkflowEdge],
      entry: ['a'],
    })
    const errs = validateWorkflow(def, regA)
    expect(codes(errs)).toContain('unknown-agent')
    expect(errs.find((e) => e.code === 'unknown-agent')?.detail).toContain('ghost')
  })

  it('悬挂边 from/to 不存在 → dangling-edge', () => {
    const def = wf({
      nodes: [node('a', 'a')],
      edges: [
        { from: 'a', to: 'nope' } as WorkflowEdge,
        { from: 'ghost', to: 'a' } as WorkflowEdge,
      ],
      entry: ['a'],
    })
    const errs = validateWorkflow(def, regA)
    expect(codes(errs).filter((c) => c === 'dangling-edge').length).toBeGreaterThanOrEqual(2)
  })

  it('环 a→b→a → cycle', () => {
    const def = wf({
      nodes: [node('a', 'a'), node('b', 'a')],
      edges: [
        { from: 'a', to: 'b' } as WorkflowEdge,
        { from: 'b', to: 'a' } as WorkflowEdge,
      ],
      entry: ['a'],
    })
    expect(codes(validateWorkflow(def, regA))).toContain('cycle')
  })

  it('入口有入边 → unreachable', () => {
    // a→b, 但 b 也被设为入口 → b 有入边 → unreachable
    const def = wf({
      nodes: [node('a', 'a'), node('b', 'a')],
      edges: [{ from: 'a', to: 'b' } as WorkflowEdge],
      entry: ['a', 'b'],
    })
    const errs = validateWorkflow(def, regA)
    expect(codes(errs)).toContain('unreachable')
    expect(errs.find((e) => e.code === 'unreachable')?.detail).toContain('incoming')
  })

  it('节点不可达 → unreachable', () => {
    // c 无入边且非入口 → 不可达
    const def = wf({
      nodes: [node('a', 'a'), node('b', 'a'), node('c', 'a')],
      edges: [{ from: 'a', to: 'b' } as WorkflowEdge],
      entry: ['a'],
    })
    const errs = validateWorkflow(def, regA)
    expect(codes(errs)).toContain('unreachable')
    expect(errs.find((e) => e.code === 'unreachable')?.detail).toContain('c')
  })

  it('{{ghost}}(非节点非 input)→ bad-template-ref', () => {
    const def = wf({
      nodes: [node('a', 'a', 'use {{ghost}}')],
      edges: [],
      entry: ['a'],
    })
    const errs = validateWorkflow(def, regA)
    expect(codes(errs)).toContain('bad-template-ref')
    expect(errs.find((e) => e.code === 'bad-template-ref')?.detail).toContain('ghost')
  })

  it('{{b}} 在 a 里(b 是 a 的下游而非上游)→ bad-template-ref', () => {
    const def = wf({
      nodes: [node('a', 'a', 'peek {{b}}'), node('b', 'a')],
      edges: [{ from: 'a', to: 'b' } as WorkflowEdge],
      entry: ['a'],
    })
    const errs = validateWorkflow(def, regA)
    expect(codes(errs)).toContain('bad-template-ref')
    expect(errs.find((e) => e.code === 'bad-template-ref')?.detail).toContain('不是上游')
  })

  it('{{input}} / {{input.foo}} → 不报', () => {
    const def = wf({
      nodes: [node('a', 'a', '{{input}} and {{input.foo}}')],
      edges: [],
      entry: ['a'],
    })
    expect(validateWorkflow(def, regA)).toEqual([])
  })
})
