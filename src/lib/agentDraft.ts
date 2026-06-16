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
  enabled: boolean
}

export function isAgentDraftValid(form: AgentForm): boolean {
  // For an acp agent with hip-managed auth, a model must be chosen.
  const needsModel = form.kind === 'acp' ? form.authMode === 'hip-managed' : form.acceptsModelConfig
  return (
    form.name.trim() !== '' &&
    form.command.trim() !== '' &&
    (!needsModel || form.boundModelKey !== '')
  )
}

export function buildAgentDraft(form: AgentForm): Omit<AgentConfig, 'id'> {
  const isAcp = form.kind === 'acp'
  // hip-managed acp agents (and any non-acp agent with the toggle on) carry a model+key.
  const acceptsModelConfig = isAcp ? form.authMode === 'hip-managed' : form.acceptsModelConfig
  const useModel = acceptsModelConfig && form.boundModelKey !== ''
  const slash = form.boundModelKey.indexOf('/')
  return {
    name: form.name.trim(),
    description: (form.description ?? '').trim() || undefined,
    kind: form.kind,
    command: form.command.trim(),
    args: form.args.trim() ? form.args.trim().split(/\s+/) : [],
    transport: form.transport,
    acceptsModelConfig,
    boundModel: useModel
      ? { providerID: form.boundModelKey.slice(0, slash), modelID: form.boundModelKey.slice(slash + 1) }
      : undefined,
    ...(isAcp ? { authMode: form.authMode } : {}),
    ...(form.quirks ? { quirks: form.quirks } : {}),
    enabled: form.enabled,
  }
}
