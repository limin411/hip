import type { AgentConfig } from '@hip/protocol'
import { LoopAgentProvider } from './loop-provider.js'
import { AcpAgentProvider } from './acp-provider.js'
import type { ResolvedModel } from './registry.js'
import type { AgentProvider } from './types.js'

export { readAgentsConfig, resolveAgentModel, type ResolvedModel } from './registry.js'
export type { AgentProvider } from './types.js'

export function createAgentProvider(agent: AgentConfig, cwd: string, model: ResolvedModel | null): AgentProvider {
  switch (agent.kind) {
    case 'custom':
      return new LoopAgentProvider(agent, cwd, model)
    case 'acp':
    case 'opencode': // legacy alias → ACP
      return new AcpAgentProvider(agent, cwd, model)
    default:
      throw new Error(`Unknown agent kind: ${(agent as { kind?: string }).kind}`)
  }
}
