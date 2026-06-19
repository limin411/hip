import { describe, it, expect } from 'vitest'
import type { AgentConfig } from '@hip/protocol'
import { agentCategory } from './agentCategory'

function a(kind: AgentConfig['kind']): AgentConfig {
  return { id: 'x', name: 'X', kind, command: '', args: [], enabled: true }
}

describe('agentCategory', () => {
  it('maps acp and the legacy opencode alias to acp', () => {
    expect(agentCategory(a('acp'))).toBe('acp')
    expect(agentCategory(a('opencode'))).toBe('acp')
  })
  it('maps custom to acp', () => {
    expect(agentCategory(a('custom'))).toBe('acp')
  })
  it('maps internal to internal', () => {
    expect(agentCategory(a('internal'))).toBe('internal')
  })
})
