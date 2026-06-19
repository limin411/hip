import type { AgentConfig } from '@hip/protocol'

export type AgentCategory = 'acp' | 'internal'

/** The UI's single source of truth for an agent's category (for grouping + badges). */
export function agentCategory(agent: Pick<AgentConfig, 'kind'>): AgentCategory {
  switch (agent.kind) {
    case 'acp':
    case 'opencode':
      return 'acp'
    case 'internal':
      return 'internal'
    case 'custom':
    default:
      return 'acp'
  }
}
