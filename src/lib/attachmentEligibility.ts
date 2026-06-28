import type { AgentConfig } from '@hip/protocol'
import type { Catalog } from '@/ipc/catalog'
import { parseModelKey } from '@/lib/modelKey'

function isMultimodalModel(key: { providerID: string; modelID: string }, catalog: Catalog): boolean {
  return !!catalog[key.providerID]?.models[key.modelID]?.attachment
}

export function isAttachmentSupported(
  currentModelKey: string | undefined,
  agents: AgentConfig[],
  catalog: Catalog,
): boolean {
  if (currentModelKey) {
    const parsed = parseModelKey(currentModelKey)
    if (isMultimodalModel(parsed, catalog)) return true
  }
  return findMultimodalAgentModelKey(agents, catalog) !== undefined
}

/** Pick the first enabled internal (non-builtin) agent whose bound model supports attachments. */
export function findMultimodalAgentModelKey(agents: AgentConfig[], catalog: Catalog): string | undefined {
  for (const agent of agents) {
    if (agent.kind !== 'internal' || !agent.enabled || agent.id === 'builtin') continue
    if (!agent.boundModel) continue
    const { providerID, modelID } = agent.boundModel
    if (isMultimodalModel({ providerID, modelID }, catalog)) return `${providerID}/${modelID}`
  }
  return undefined
}
