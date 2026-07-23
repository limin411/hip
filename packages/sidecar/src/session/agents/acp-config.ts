import type { AgentConfig } from '@hip/protocol'
import type { ResolvedModel } from './registry.js'
import { buildHipKeyForwardEnv } from '../../config/auth-file.js'
export { resolveAcpHostConfig, type ResolvedAcpHostConfig } from '../../config/hip-config.js'
import { resolveAcpHostConfig } from '../../config/hip-config.js'

export interface AcpSpawn { command: string; args: string[]; env: NodeJS.ProcessEnv }

// Model rollback: hip no longer pushes its model/key into ACP agents by default — they
// self-manage (the legacy `hip-managed` authMode is ignored at runtime). Opt-in
// `[acp] forward_hip_keys = true` injects resolved hip keys under standard env names.
// The `model` param is retained only for the shared (agent, model) factory signature.
export function buildAcpSpawn(agent: AgentConfig, model: ResolvedModel | null): AcpSpawn {
  // ACP presets bake command/args at add-time. agent.env carries user-supplied keys
  // (claude-code/codex/grok-build). Optional host forwardHipKeys merges hip auth last
  // only for names not already set by process.env / agent.env.
  void model
  const env: NodeJS.ProcessEnv = { ...process.env, ...(agent.env ?? {}) }
  const host = resolveAcpHostConfig()
  if (host.forwardHipKeys) {
    const forwarded = buildHipKeyForwardEnv(env)
    Object.assign(env, forwarded)
  }
  return { command: agent.command, args: agent.args, env }
}
