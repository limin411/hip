import type { AgentConfig } from '@hip/protocol'
import type { ResolvedModel } from './registry.js'

export interface AcpSpawn { command: string; args: string[]; env: NodeJS.ProcessEnv }

// Model rollback: hip no longer pushes its model/key into ACP agents — they self-manage (the legacy
// `hip-managed` authMode is ignored at runtime). The `model` param is retained only for the shared
// (agent, model) provider/connection factory signature; it is intentionally unused here.
export function buildAcpSpawn(agent: AgentConfig, model: ResolvedModel | null): AcpSpawn {
  // All four ACP presets (opencode/kimi-code/claude-code/codex) bake their concrete command/args
  // at add-time (src/lib/acpPresets.ts), so this path spawns them verbatim. agent.env carries any
  // user-supplied API key (claude-code/codex). Self-managed: no model/key injection here.
  void model
  const env: NodeJS.ProcessEnv = { ...process.env, ...(agent.env ?? {}) }
  // All ACP agents are self-managed: inject nothing model/key-related; OpenCode reads its own auth.json.
  return { command: agent.command, args: agent.args, env }
}
