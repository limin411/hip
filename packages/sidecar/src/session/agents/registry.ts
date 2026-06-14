import { readFileSync } from 'node:fs'
import type { AgentConfig, AgentsConfig } from '@hip/protocol'
import { resolveApiKey } from '../../config/auth-file.js'
import { resolveProviderBaseURL } from '../../config/providers.js'

export interface ResolvedModel { providerID: string; modelID: string; baseURL: string; apiKey?: string }

/** Read the registered external agents from HIP_AGENTS_PATH. Missing/corrupt file → []. */
export function readAgentsConfig(): AgentConfig[] {
  const file = process.env.HIP_AGENTS_PATH?.trim()
  if (!file) return []
  try {
    const cfg = JSON.parse(readFileSync(file, 'utf8')) as AgentsConfig
    return Array.isArray(cfg?.agents) ? cfg.agents : []
  } catch {
    return []
  }
}

/** Resolve an agent's bound model to a concrete {providerID, modelID, baseURL, apiKey}, or null. */
export function resolveAgentModel(agent: AgentConfig): ResolvedModel | null {
  if (!agent.boundModel) return null
  const { providerID, modelID } = agent.boundModel
  return { providerID, modelID, baseURL: resolveProviderBaseURL(providerID), apiKey: resolveApiKey(providerID) }
}
