import type { AgentConfig, AgentAuthMode } from '@hip/protocol'
import { groupsToToolNames } from './agentTools'

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
  enabled: boolean
}

export function isAgentDraftValid(form: AgentForm): boolean {
  if (form.kind === 'internal') {
    return form.name.trim() !== '' && form.prompt.trim() !== ''
  }
  // For an acp agent with hip-managed auth, a model must be chosen.
  const needsModel = form.kind === 'acp' ? form.authMode === 'hip-managed' : form.acceptsModelConfig
  return (
    form.name.trim() !== '' &&
    form.command.trim() !== '' &&
    (!needsModel || form.boundModelKey !== '')
  )
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
      allowedTools: groupsToToolNames({ read: form.toolsRead, edit: form.toolsEdit, plan: form.toolsPlan, git: form.toolsGit }),
      boundModel: parseBoundModel(form.boundModelKey),
      enabled: form.enabled,
    }
  }

  const isAcp = form.kind === 'acp'
  const acceptsModelConfig = isAcp ? form.authMode === 'hip-managed' : form.acceptsModelConfig
  const useModel = acceptsModelConfig && form.boundModelKey !== ''
  return {
    name: form.name.trim(),
    description: (form.description ?? '').trim() || undefined,
    kind: form.kind,
    command: form.command.trim(),
    args: form.args.trim() ? form.args.trim().split(/\s+/) : [],
    transport: form.transport,
    acceptsModelConfig,
    boundModel: useModel ? parseBoundModel(form.boundModelKey) : undefined,
    ...(isAcp ? { authMode: form.authMode } : {}),
    ...(form.quirks ? { quirks: form.quirks } : {}),
    enabled: form.enabled,
  }
}
