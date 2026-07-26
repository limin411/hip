/**
 * FE helpers for roundtable council multi-agent projection.
 * See docs/design/roundtable-council.md.
 */
import type { RoundtableEdge, RoundtableMeta } from '@hip/protocol'
import type { TurnAgent } from '@/lib/turnAgents'

export const COUNCIL_AGENT_PREFIX = 'roundtable:'

export const COUNCIL_PERSONAS = [
  'strategist',
  'skeptic',
  'creative',
  'operator',
  'audience',
] as const

export type CouncilPersona = (typeof COUNCIL_PERSONAS)[number]

export function councilAgentId(persona: CouncilPersona): string {
  return `${COUNCIL_AGENT_PREFIX}${persona}`
}

export function isCouncilAgentId(agentId: string): boolean {
  return agentId.startsWith(COUNCIL_AGENT_PREFIX)
}

export function isCouncilRoundtable(meta?: RoundtableMeta | null): boolean {
  return meta?.engine === 'council' && meta.convened === true
}

/** Live council detection before message:complete meta arrives. */
export function isCouncilLiveAgents(agents: TurnAgent[], meta?: RoundtableMeta | null): boolean {
  if (isCouncilRoundtable(meta)) return true
  return agents.some((a) => a.agentId.startsWith(COUNCIL_AGENT_PREFIX))
}

export type CouncilRosterStatus = TurnAgent['status'] | 'waiting'

export interface CouncilRosterSeat {
  agentId: string
  persona: CouncilPersona
  nameKey: `chat.roundtable.personas.${CouncilPersona}`
  status: CouncilRosterStatus
  agent?: TurnAgent
}

/** Merge live turn agents with fixed 5-seat council roster. */
export function mergeCouncilRoster(
  agents: TurnAgent[],
  meta?: RoundtableMeta | null,
): CouncilRosterSeat[] | null {
  if (!isCouncilLiveAgents(agents, meta)) return null
  const byId = new Map(agents.map((a) => [a.agentId, a]))
  return COUNCIL_PERSONAS.map((persona) => {
    const agentId = councilAgentId(persona)
    const agent = byId.get(agentId)
    return {
      agentId,
      persona,
      nameKey: `chat.roundtable.personas.${persona}` as const,
      status: agent ? agent.status : 'waiting',
      agent,
    }
  })
}

export function councilEdges(meta?: RoundtableMeta | null): RoundtableEdge[] {
  return meta?.edges ?? []
}
