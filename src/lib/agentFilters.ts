import type { AgentConfig } from '@hip/protocol'
import { agentCategory } from './agentCategory'

export type AgentFilter = 'all' | 'builtin' | 'acp' | 'internal'
export type AgentFilterIcon = 'layout-grid' | 'sparkles' | 'bot' | 'terminal' | 'plug'

export interface AgentFilterEntry {
  id: AgentFilter
  icon: AgentFilterIcon
}

/** Fixed, ordered rail entries: overview, built-in, then the three categories. */
export const AGENT_FILTERS: AgentFilterEntry[] = [
  { id: 'all', icon: 'layout-grid' },
  { id: 'builtin', icon: 'sparkles' },
  { id: 'internal', icon: 'bot' },
  { id: 'acp', icon: 'plug' },
]

/**
 * Per-entry counts. builtin is always 1 (the single hip core agent); all = builtin + every
 * configured agent; internal/acp = configured agents in that category.
 */
export function agentFilterCounts(agents: AgentConfig[]): Record<AgentFilter, number> {
  const counts: Record<AgentFilter, number> = { all: agents.length + 1, builtin: 1, acp: 0, internal: 0 }
  for (const agent of agents) {
    const category = agentCategory(agent)
    if (category in counts) counts[category] += 1
  }
  return counts
}
