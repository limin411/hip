import type { AgentConfig } from '@hip/protocol'
import { resolveEffectiveConfig } from '../../config/hip-config.js'
import { resolveApiKey } from '../../config/auth-file.js'
import { resolveProviderBaseURL } from '../../config/providers.js'

export interface ResolvedModel { providerID: string; modelID: string; baseURL: string; apiKey?: string }

/** Read the registered external agents from hip.toml (global + project). */
export function readAgentsConfig(cwd: string): AgentConfig[] {
  return resolveEffectiveConfig(cwd).agents ?? []
}

/** Resolve an agent's bound model to a concrete {providerID, modelID, baseURL, apiKey}, or null. */
export function resolveAgentModel(agent: AgentConfig, cwd: string): ResolvedModel | null {
  if (!agent.boundModel) return null
  const { providerID, modelID } = agent.boundModel
  // Resolve baseURL from the effective config (global + project) so a project-level provider
  // override applies — consistent with how readAgentsConfig() reads the agent list. Fall back
  // to the global default resolver when the provider has no entry.
  const override = resolveEffectiveConfig(cwd).providers?.find((p) => p.id === providerID)?.baseUrl
  const baseURL = override || resolveProviderBaseURL(providerID)
  return { providerID, modelID, baseURL, apiKey: resolveApiKey(providerID) }
}
