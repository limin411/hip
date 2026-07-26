import type { CastSeat, PersonaId, RoundtableLang } from './types.js'
import { PERSONA_IDS } from './types.js'
import { personaLabelFromBrief, seatTitle } from './persona-briefs.js'

export const COUNCIL_AGENT_PREFIX = 'roundtable:'

export function councilAgentId(persona: PersonaId): string {
  return `${COUNCIL_AGENT_PREFIX}${persona}`
}

export function personaFromAgentId(agentId: string): PersonaId | null {
  if (!agentId.startsWith(COUNCIL_AGENT_PREFIX)) return null
  const p = agentId.slice(COUNCIL_AGENT_PREFIX.length) as PersonaId
  return (PERSONA_IDS as readonly string[]).includes(p) ? p : null
}

export function isCouncilAgentId(agentId: string): boolean {
  return personaFromAgentId(agentId) != null
}

/** Display name: L3 cast title if provided, else L1 label. */
export function councilDisplayName(
  persona: PersonaId,
  lang: RoundtableLang,
  cast?: CastSeat[] | null,
): string {
  if (cast?.length) return seatTitle(persona, lang, cast)
  return personaLabelFromBrief(persona, lang)
}
