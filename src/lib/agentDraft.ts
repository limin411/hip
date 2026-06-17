import type { AgentConfig, AgentAuthMode } from '@hip/protocol'
import { groupsToToolNames, mcpServerWildcard } from './agentTools'

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
  toolsRead: boolean
  toolsEdit: boolean
  toolsPlan: boolean
  toolsGit: boolean
  toolsSkill: boolean
  toolsScript: boolean
  mcpServerIds: string[]   // serverIds granted whole-server access (→ mcp__<id>__* wildcards)
  enabled: boolean
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
      allowedTools: [
        ...groupsToToolNames({
          read: form.toolsRead,
          edit: form.toolsEdit,
          plan: form.toolsPlan,
          git: form.toolsGit,
          skill: form.toolsSkill,
          script: form.toolsScript,
        }),
        ...form.mcpServerIds.map(mcpServerWildcard),
      ],
      boundModel: parseBoundModel(form.boundModelKey),
      enabled: form.enabled,
    }
  }

  // Model rollback: external agents (acp + custom) self-manage. We never push a model, so
  // acceptsModelConfig is always false and no boundModel/authMode is emitted (legacy fields stay
  // inert in the type for back-compat with already-saved configs).
  return {
    name: form.name.trim(),
    description: (form.description ?? '').trim() || undefined,
    kind: form.kind,
    command: form.command.trim(),
    args: form.args.trim() ? form.args.trim().split(/\s+/) : [],
    transport: form.transport,
    acceptsModelConfig: false,
    ...(form.quirks ? { quirks: form.quirks } : {}),
    enabled: form.enabled,
  }
}
