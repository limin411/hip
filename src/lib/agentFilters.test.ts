import { describe, it, expect } from 'vitest'
import type { AgentConfig } from '@hip/protocol'
import { AGENT_FILTERS, agentFilterCounts } from './agentFilters'

function a(kind: AgentConfig['kind']): AgentConfig {
  return { id: Math.random().toString(36).slice(2), name: 'X', kind, command: '', args: [], transport: 'thin', acceptsModelConfig: false, enabled: true }
}

describe('AGENT_FILTERS', () => {
  it('lists the five entries in order', () => {
    expect(AGENT_FILTERS.map((f) => f.id)).toEqual(['all', 'builtin', 'internal', 'cli', 'acp'])
  })
})

describe('agentFilterCounts', () => {
  it('counts an empty roster as just the built-in', () => {
    expect(agentFilterCounts([])).toEqual({ all: 1, builtin: 1, acp: 0, cli: 0, internal: 0 })
  })
  it('counts a mixed roster by category, all = agents + builtin', () => {
    const agents = [a('internal'), a('internal'), a('custom'), a('acp'), a('opencode')]
    expect(agentFilterCounts(agents)).toEqual({ all: 6, builtin: 1, internal: 2, cli: 1, acp: 2 })
  })
})
