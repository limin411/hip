import type { AgentConfig } from '@hip/protocol'
import type { Catalog } from '@/ipc/catalog'
import { parseModelKey } from '@/lib/modelKey'

export function isAttachmentSupported(
  currentModelKey: string | undefined,
  agents: AgentConfig[],
  catalog: Catalog,
): boolean {
  if (currentModelKey) {
    const { providerID, modelID } = parseModelKey(currentModelKey)
    if (catalog[providerID]?.models[modelID]?.attachment) return true
  }
  for (const agent of agents) {
    if (agent.kind !== 'internal' || !agent.enabled || agent.id === 'builtin') continue
    if (!agent.boundModel) continue
    const { providerID, modelID } = agent.boundModel
    if (catalog[providerID]?.models[modelID]?.attachment) return true
  }
  return false
}
