import type { AgentConfig } from '@hip/protocol'
import { AcpAgentProvider } from './acp-provider.js'
import type { ResolvedModel } from './registry.js'
import type { AgentProvider } from './types.js'

export { readAgentsConfig, resolveAgentModel, type ResolvedModel } from './registry.js'
export type { AgentProvider } from './types.js'

export function createAgentProvider(agent: AgentConfig, cwd: string, model: ResolvedModel | null): AgentProvider {
  if (agent.kind === 'custom') {
    console.error(`[hip] Skipping legacy CLI agent "${agent.name}" (kind:'custom' no longer supported — use ACP). Remove it from ~/.hip/config/hip.toml.`)
    throw new Error(`Legacy CLI agent "${agent.name}" is no longer supported`)
  }
  switch (agent.kind) {
    case 'acp':
    case 'opencode': // legacy alias → ACP
      return new AcpAgentProvider(agent, cwd, model)
    default:
      throw new Error(`Unknown agent kind: ${(agent as { kind?: string }).kind}`)
  }
}
