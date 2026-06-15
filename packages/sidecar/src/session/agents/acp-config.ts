import type { AgentConfig } from '@hip/protocol'
import type { ResolvedModel } from './registry.js'

// TEMPORARY STUB (Task 1.5). The real implementation lands in Task 3.1
// (`acp-config.ts` — build spawn env/config for both auth modes) and overwrites this file.
export interface AcpSpawn { command: string; args: string[]; env: NodeJS.ProcessEnv }

export function buildAcpSpawn(agent: AgentConfig, _model: ResolvedModel | null): AcpSpawn {
  return { command: agent.command, args: agent.args, env: { ...process.env, ...agent.env } }
}
