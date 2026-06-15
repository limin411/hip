import type { AgentConfig } from '@hip/protocol'

export interface AgentForm {
  name: string
  command: string
  args: string
  transport: AgentConfig['transport']
  acceptsModelConfig: boolean
  boundModelKey: string
  enabled: boolean
}

export function isAgentDraftValid(form: AgentForm): boolean {
  return (
    form.name.trim() !== '' &&
    form.command.trim() !== '' &&
    (!form.acceptsModelConfig || form.boundModelKey !== '')
  )
}

export function buildAgentDraft(form: AgentForm): Omit<AgentConfig, 'id'> {
  const useModel = form.acceptsModelConfig && form.boundModelKey !== ''
  const slash = form.boundModelKey.indexOf('/')
  return {
    name: form.name.trim(),
    kind: 'custom',
    command: form.command.trim(),
    args: form.args.trim() ? form.args.trim().split(/\s+/) : [],
    transport: form.transport,
    acceptsModelConfig: form.acceptsModelConfig,
    boundModel: useModel
      ? { providerID: form.boundModelKey.slice(0, slash), modelID: form.boundModelKey.slice(slash + 1) }
      : undefined,
    enabled: form.enabled,
  }
}
