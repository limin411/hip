import type { AgentConfig, AgentCapabilities, AgentDescriptor, AgentId } from '@hip/protocol'

/**
 * Workflow-orchestrator static capabilities by agent kind.
 * Not ACP host runtime caps (those live on AcpConnection as AcpAgentRuntimeCaps from initialize).
 * Do not drive session/load, MCP filter, or set_config_option from this table.
 */
export function capabilitiesFor(kind: AgentConfig['kind']): AgentCapabilities {
  switch (kind) {
    case 'acp':
    case 'opencode':
      return { streamsReasoning: true, toolCalls: true, hitl: true, modelSwitch: true }
    case 'custom':
    default:
      return { streamsReasoning: true, toolCalls: true, hitl: false, modelSwitch: false }
  }
}

export interface AgentRegistry {
  get(id: AgentId): AgentDescriptor | undefined
  has(id: AgentId): boolean
  all(): AgentDescriptor[]
  withCapability(pred: (c: AgentCapabilities) => boolean): AgentDescriptor[]
}

export function buildRegistry(configs: AgentConfig[]): AgentRegistry {
  const map = new Map<AgentId, AgentDescriptor>()
  for (const c of configs) {
    map.set(c.id, { id: c.id, name: c.name, kind: c.kind, capabilities: capabilitiesFor(c.kind) })
  }
  return {
    get: (id) => map.get(id),
    has: (id) => map.has(id),
    all: () => [...map.values()],
    withCapability: (pred) => [...map.values()].filter((d) => pred(d.capabilities)),
  }
}
