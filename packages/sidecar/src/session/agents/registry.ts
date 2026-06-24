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
export function resolveAgentModel(agent: AgentConfig): ResolvedModel | null {
  if (!agent.boundModel) return null
  const { providerID, modelID } = agent.boundModel
  return { providerID, modelID, baseURL: resolveProviderBaseURL(providerID), apiKey: resolveApiKey(providerID) }
}
