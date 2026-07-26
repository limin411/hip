import type { SpeechEnvelope } from './speech-schema.js'
import type { PersonaId } from './types.js'

export interface CouncilEdge {
  round: number
  from: PersonaId
  to: PersonaId
  relation: 'support' | 'rebut' | 'question'
  summary: string
}

/** Derive discussion edges from a speaker's acts. */
export function edgesFromEnvelope(
  round: number,
  speaker: PersonaId,
  envelope: SpeechEnvelope,
): CouncilEdge[] {
  const out: CouncilEdge[] = []
  for (const act of envelope.acts) {
    if (act.kind !== 'support' && act.kind !== 'rebut' && act.kind !== 'question') continue
    if (!act.target || act.target === speaker) continue
    out.push({
      round,
      from: speaker,
      to: act.target,
      relation: act.kind,
      summary: (act.attack || act.claim || act.reason || '').slice(0, 200),
    })
  }
  return out
}

export function dedupeEdges(edges: CouncilEdge[]): CouncilEdge[] {
  const seen = new Set<string>()
  const out: CouncilEdge[] = []
  for (const e of edges) {
    const k = `${e.round}|${e.from}|${e.to}|${e.relation}|${e.summary}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(e)
  }
  return out
}
