import { describe, it, expect } from 'vitest'
import type { AgentConfig } from '@hip/protocol'
import { AGENT_FILTERS, agentFilterCounts } from './agentFilters'

function a(kind: AgentConfig['kind']): AgentConfig {
  return { id: Math.random().toString(36).slice(2), name: 'X', kind, command: '', args: [], enabled: true }
}

describe('AGENT_FILTERS', () => {
  it('lists the visible entries in order (built-in hidden)', () => {
    expect(AGENT_FILTERS.map((f) => f.id)).toEqual(['all', 'internal', 'acp'])
  })
})

describe('agentFilterCounts', () => {
  it('counts only configured agents when roster is empty', () => {
    expect(agentFilterCounts([])).toEqual({ all: 0, builtin: 0, acp: 0, internal: 0 })
  })
  it('counts a mixed roster by category (built-in excluded)', () => {
    const agents = [a('internal'), a('internal'), a('custom'), a('acp'), a('opencode')]
    expect(agentFilterCounts(agents)).toEqual({ all: 5, builtin: 0, internal: 2, acp: 3 })
  })
})
