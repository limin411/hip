import type { AgentConfig } from '@hip/protocol'
import { agentCategory } from './agentCategory'

export type AgentFilter = 'all' | 'builtin' | 'acp' | 'internal'
export type AgentFilterIcon = 'layout-grid' | 'sparkles' | 'bot' | 'terminal' | 'plug'

export interface AgentFilterEntry {
  id: AgentFilter
  icon: AgentFilterIcon
}

/** Icon-only rail entries shown in the UI. The built-in agent is hidden from this list. */
export const AGENT_FILTERS: AgentFilterEntry[] = [
  { id: 'all', icon: 'layout-grid' },
  { id: 'internal', icon: 'bot' },
  { id: 'acp', icon: 'plug' },
]

/**
 * Per-entry counts. The built-in agent is no longer shown in the UI, so `all`
 * counts only configured agents and `builtin` is kept at 0 for type compatibility.
 */
export function agentFilterCounts(agents: AgentConfig[]): Record<AgentFilter, number> {
  const counts: Record<AgentFilter, number> = { all: agents.length, builtin: 0, acp: 0, internal: 0 }
  for (const agent of agents) {
    const category = agentCategory(agent)
    if (category in counts) counts[category] += 1
  }
  return counts
}
