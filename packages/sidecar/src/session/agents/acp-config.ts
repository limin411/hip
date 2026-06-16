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
  // NOTE: this spawn path is OpenCode-shaped (writes opencode.json via OPENCODE_CONFIG). A future ACP
  // provider (claude-code/codex/kimi-code) will branch here on its preset/quirks. Reserved — not
  // reachable yet because only OpenCode is selectable in the provider picker (src/lib/acpPresets.ts).
  const env: NodeJS.ProcessEnv = { ...process.env, ...(agent.env ?? {}) }

  if (agent.authMode === 'hip-managed') {
    // G1: hip-managed means hip OWNS the model+key. Without a resolved model OpenCode would fall
    // back to its billed default (opencode/big-pickle) — fail loudly instead of silently billing.
    if (!model) {
      throw new Error(`Agent "${agent.id}" is in hip-managed auth mode but has no resolved model — bind a model (boundModel + acceptsModelConfig) so OpenCode does not fall back to a billed default.`)
    }
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
