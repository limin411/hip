import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentConfig } from '@hip/protocol'
import type { ResolvedModel } from './registry.js'

/** Provider id → the env var OpenCode auto-recognizes for that provider's key. */
function providerEnvVar(providerID: string): string {
  return `${providerID.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`
}

export interface AcpSpawn { command: string; args: string[]; env: NodeJS.ProcessEnv }

export function buildAcpSpawn(agent: AgentConfig, model: ResolvedModel | null): AcpSpawn {
  const env: NodeJS.ProcessEnv = { ...process.env, ...(agent.env ?? {}) }

  if (agent.authMode === 'hip-managed' && model) {
    // G3: {env:} substitution does NOT run for OPENCODE_CONFIG_CONTENT — use a written file via OPENCODE_CONFIG.
    const keyEnv = providerEnvVar(model.providerID)
    const cfg: Record<string, unknown> = {
      $schema: 'https://opencode.ai/config.json',
      model: `${model.providerID}/${model.modelID}`, // G1: always set a model (else opencode/big-pickle bills)
      provider: { [model.providerID]: { options: { apiKey: `{env:${keyEnv}}`, ...(model.baseURL ? { baseURL: model.baseURL } : {}) } } },
    }
    const dir = mkdtempSync(join(tmpdir(), 'hip-acp-cfg-'))
    const file = join(dir, 'opencode.json')
    writeFileSync(file, JSON.stringify(cfg, null, 2))
    env.OPENCODE_CONFIG = file
    if (model.apiKey) env[keyEnv] = model.apiKey
  }
  // opencode-self mode: inject nothing key-related; OpenCode reads its own auth.json.

  return { command: agent.command, args: agent.args, env }
}
