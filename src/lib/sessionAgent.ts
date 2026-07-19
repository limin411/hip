/** Session primary runtime: hip built-in graph vs external ACP agent. */
export type AgentRuntimeMode = 'builtin' | 'acp_primary'

/**
 * Resolve primary runtime from SessionConfig.agentId / draft.agentId.
 * undefined | '' | 'builtin' → hip Supervisor; any other id → ACP primary.
 */
export function runtimeModeOf(agentId: string | undefined | null): AgentRuntimeMode {
  return agentId && agentId !== 'builtin' ? 'acp_primary' : 'builtin'
}

/** True when the session/draft is driven by an external ACP agent. */
export function isExternalPrimary(agentId: string | undefined | null): boolean {
  return runtimeModeOf(agentId) === 'acp_primary'
}
