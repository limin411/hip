import { describe, it, expect } from 'vitest'
import { buildClusterDefaultWorkflow } from './builtin-workflows.js'

describe('buildClusterDefaultWorkflow', () => {
  it('returns planner → coder linear graph with stable id', () => {
    const def = buildClusterDefaultWorkflow()
    expect(def.id).toBe('builtin:cluster-default')
    expect(def.entry).toEqual(['planner'])
    expect(def.nodes.map((n) => n.id)).toEqual(['planner', 'coder'])
    expect(def.nodes.every((n) => n.type === 'agent')).toBe(true)
    expect(def.edges).toEqual([{ from: 'planner', to: 'coder' }])
  })

  it('planner inputTemplate references {{input}}', () => {
    const def = buildClusterDefaultWorkflow()
    const planner = def.nodes.find((n) => n.id === 'planner')
    expect(planner && 'inputTemplate' in planner && planner.inputTemplate).toMatch(/\{\{\s*input\s*\}\}/)
  })

  it('coder inputTemplate references {{planner}} and {{input}}', () => {
    const def = buildClusterDefaultWorkflow()
    const coder = def.nodes.find((n) => n.id === 'coder')
    expect(coder && 'inputTemplate' in coder && coder.inputTemplate).toMatch(/\{\{\s*planner\s*\}\}/)
    expect(coder && 'inputTemplate' in coder && coder.inputTemplate).toMatch(/\{\{\s*input\s*\}\}/)
  })

  it('uses real plan/coder profiles (not legacy worker)', () => {
    const def = buildClusterDefaultWorkflow()
    const planner = def.nodes.find((n) => n.id === 'planner')
    const coder = def.nodes.find((n) => n.id === 'coder')
    expect(planner && 'agentId' in planner && planner.agentId).toBe('plan')
    expect(coder && 'agentId' in coder && coder.agentId).toBe('coder')
  })
})
