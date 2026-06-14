import type { AgentConfig } from '@hip/protocol'
import { LoopAgentProvider, type AgentProvider } from './loop-provider.js'
import type { ResolvedModel } from './registry.js'

export { readAgentsConfig, resolveAgentModel, type ResolvedModel } from './registry.js'
export type { AgentProvider } from './loop-provider.js'

/** Build the provider for an external agent. Plan A supports 'custom'; 'opencode' arrives in Plan B. */
export function createAgentProvider(agent: AgentConfig, cwd: string, model: ResolvedModel | null): AgentProvider {
  switch (agent.kind) {
    case 'custom':
      return new LoopAgentProvider(agent, cwd, model)
    case 'opencode':
      throw new Error('OpenCode agent support is not available in this build (Plan B).')
    default:
      throw new Error(`Unknown agent kind: ${(agent as AgentConfig).kind}`)
  }
}
