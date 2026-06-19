import type { AgentConfig, AgentAuthMode } from '@hip/protocol'

export interface AgentForm {
  name: string
  description?: string
  kind: AgentConfig['kind']
  command: string
  args: string
  transport: AgentConfig['transport']
  acceptsModelConfig: boolean
  boundModelKey: string
  authMode: AgentAuthMode
  quirks?: string
  // internal-only fields:
  prompt: string
  allowedSkills: string[]      // skill ids this internal agent may use (use_skill restricted to these)
  allowedMcpServers: string[]  // MCP server ids whose tools this internal agent may use
  enabled: boolean
  // ACP adapter auth (Claude Code / Codex): the key is stored in the agent's env.
  apiKey?: string              // value for authEnvVar; blank/undefined ⇒ rely on ambient env
  authEnvVar?: string          // which env var apiKey maps to; undefined ⇒ no key field
  env?: Record<string, string> // existing env to preserve across edits
}

export function isAgentDraftValid(form: AgentForm): boolean {
  if (form.kind === 'internal') {
    return form.name.trim() !== '' && form.prompt.trim() !== ''
  }
  // Model rollback: external agents (acp + custom) self-manage — a model is never required.
  return form.name.trim() !== '' && form.command.trim() !== ''
}

function parseBoundModel(key: string): AgentConfig['boundModel'] {
  if (key === '') return undefined
  const slash = key.indexOf('/')
  return { providerID: key.slice(0, slash), modelID: key.slice(slash + 1) }
}

export function buildAgentDraft(form: AgentForm): Omit<AgentConfig, 'id'> {
  if (form.kind === 'internal') {
    return {
      name: form.name.trim(),
      description: (form.description ?? '').trim() || undefined,
      kind: 'internal',
      command: '',
      args: [],
      transport: 'thin',
      acceptsModelConfig: false,
      prompt: form.prompt.trim(),
      // Built-in tools are always available; only per-agent skill/MCP grants are configured here. The
      // sidecar no longer gates built-ins by an allow-list, so explicitly emit allowedTools: undefined
      // — agentsStore.updateAgent does a shallow merge ({ ...x, ...patch }), and emitting the key clears
      // any legacy allowedTools value left on a migrated internal agent when it is re-saved.
      allowedTools: undefined,
      allowedSkills: [...form.allowedSkills],
      allowedMcpServers: [...form.allowedMcpServers],
      boundModel: parseBoundModel(form.boundModelKey),
      enabled: form.enabled,
    }
  }

  // Model rollback: external agents (acp + custom) self-manage. We never push a model, so
  // acceptsModelConfig is always false and no boundModel/authMode is emitted (legacy fields stay
  // inert in the type for back-compat with already-saved configs).
  const env0 = { ...(form.env ?? {}) }
  if (form.authEnvVar) {
    const v = (form.apiKey ?? '').trim()
    if (v) env0[form.authEnvVar] = v
    else delete env0[form.authEnvVar]
  }
  const env = Object.keys(env0).length ? env0 : undefined
  return {
    name: form.name.trim(),
    description: (form.description ?? '').trim() || undefined,
    kind: form.kind,
    command: form.command.trim(),
    args: form.args.trim() ? form.args.trim().split(/\s+/) : [],
    transport: form.transport,
    acceptsModelConfig: false,
    ...(form.quirks ? { quirks: form.quirks } : {}),
    ...(env ? { env } : {}),
    enabled: form.enabled,
  }
}
