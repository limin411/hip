import { describe, it, expect } from 'vitest'
import type { AgentConfig } from '@hip/protocol'
import { capabilitiesFor, buildRegistry } from './registry.js'

describe('capabilitiesFor', () => {
  it('acp 全 true', () => {
    expect(capabilitiesFor('acp')).toEqual({
      streamsReasoning: true,
      toolCalls: true,
      hitl: true,
      modelSwitch: true,
    })
  })

  it('opencode 全 true', () => {
    expect(capabilitiesFor('opencode')).toEqual({
      streamsReasoning: true,
      toolCalls: true,
      hitl: true,
      modelSwitch: true,
    })
  })

  it('custom: hitl/modelSwitch=false、reasoning/tool=true', () => {
    expect(capabilitiesFor('custom')).toEqual({
      streamsReasoning: true,
      toolCalls: true,
      hitl: false,
      modelSwitch: false,
    })
  })
})

describe('buildRegistry', () => {
  const configs: AgentConfig[] = [
    { id: 'a1', name: 'Custom One', kind: 'custom', enabled: true } as AgentConfig,
    { id: 'a2', name: 'OpenCode', kind: 'opencode', enabled: true } as AgentConfig,
    { id: 'a3', name: 'Acp Agent', kind: 'acp', enabled: true } as AgentConfig,
  ]

  it('get 返回对应 descriptor，未知 id 为 undefined', () => {
    const reg = buildRegistry(configs)
    expect(reg.get('a1')).toEqual({
      id: 'a1',
      name: 'Custom One',
      kind: 'custom',
      capabilities: { streamsReasoning: true, toolCalls: true, hitl: false, modelSwitch: false },
    })
    expect(reg.get('a3')).toEqual({
      id: 'a3',
      name: 'Acp Agent',
      kind: 'acp',
      capabilities: { streamsReasoning: true, toolCalls: true, hitl: true, modelSwitch: true },
    })
    expect(reg.get('nope')).toBeUndefined()
  })

  it('has 正确反映存在性', () => {
    const reg = buildRegistry(configs)
    expect(reg.has('a2')).toBe(true)
    expect(reg.has('missing')).toBe(false)
  })

  it('all 返回全部 descriptor', () => {
    const reg = buildRegistry(configs)
    const all = reg.all()
    expect(all.map((d) => d.id).sort()).toEqual(['a1', 'a2', 'a3'])
  })

  it('withCapability((c)=>c.hitl) 只返回 acp/opencode', () => {
    const reg = buildRegistry(configs)
    const hitl = reg.withCapability((c) => c.hitl)
    expect(hitl.map((d) => d.id).sort()).toEqual(['a2', 'a3'])
  })

  it('空配置 → all 为空，get/has 安全', () => {
    const reg = buildRegistry([])
    expect(reg.all()).toEqual([])
    expect(reg.has('x')).toBe(false)
    expect(reg.get('x')).toBeUndefined()
  })
})
