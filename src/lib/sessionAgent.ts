import type { AgentConfig } from '@hip/protocol'

/** Session primary runtime: hip built-in graph vs external ACP agent. */
export type AgentRuntimeMode = 'builtin' | 'acp_primary'

/**
 * Resolve primary runtime from SessionConfig.agentId / draft.agentId.
 * undefined | '' | whitespace | 'builtin' → hip Supervisor; any other id → ACP primary.
 */
export function runtimeModeOf(agentId: string | undefined | null): AgentRuntimeMode {
  const id = typeof agentId === 'string' ? agentId.trim() : ''
  return id && id !== 'builtin' ? 'acp_primary' : 'builtin'
}

/** True when the session/draft is driven by an external ACP agent. */
export function isExternalPrimary(agentId: string | undefined | null): boolean {
  return runtimeModeOf(agentId) === 'acp_primary'
}

/**
 * Sidecar createAgentProvider treats `acp` and legacy `opencode` as ACP-capable primaries.
 * Shared by picker filter and configFromDraft validation (and future setAgent).
 */
export function isAcpCapableAgent(
  agent: Pick<AgentConfig, 'kind' | 'enabled'> | undefined | null,
): boolean {
  if (!agent || !agent.enabled) return false
  return agent.kind === 'acp' || agent.kind === 'opencode'
}

/**
 * Resolve a draft/session agentId against the agents list.
 * Returns the id only when it names an enabled ACP-capable agent; otherwise undefined (builtin).
 */
export function resolveValidAcpAgentId(
  agentId: string | undefined | null,
  agents: readonly Pick<AgentConfig, 'id' | 'kind' | 'enabled'>[],
): string | undefined {
  const id = typeof agentId === 'string' ? agentId.trim() : ''
  if (!id || id === 'builtin') return undefined
  const agent = agents.find((a) => a.id === id)
  return isAcpCapableAgent(agent) ? id : undefined
}
