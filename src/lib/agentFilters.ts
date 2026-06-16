import type { AgentConfig } from '@hip/protocol'
import { agentCategory, type AgentCategory } from './agentCategory'

export type AgentFilter = 'all' | 'builtin' | AgentCategory // 'all' | 'builtin' | 'acp' | 'cli' | 'internal'
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
  { id: 'cli', icon: 'terminal' },
  { id: 'acp', icon: 'plug' },
]

/**
 * Per-entry counts. builtin is always 1 (the single hip core agent); all = builtin + every
 * configured agent; internal/cli/acp = configured agents in that category.
 */
export function agentFilterCounts(agents: AgentConfig[]): Record<AgentFilter, number> {
  const counts: Record<AgentFilter, number> = { all: agents.length + 1, builtin: 1, acp: 0, cli: 0, internal: 0 }
  for (const agent of agents) counts[agentCategory(agent)] += 1
  return counts
}
