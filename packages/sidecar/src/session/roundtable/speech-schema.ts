import { PERSONA_IDS, type PersonaId } from './types.js'
import { extractJsonObject } from './schema.js'

export type SpeechActKind = 'open' | 'support' | 'rebut' | 'revise' | 'question' | 'vote'

export interface SpeechAct {
  kind: SpeechActKind
  claim: string
  target?: PersonaId
  claimId?: string
  attack?: string
  priorClaim?: string
  optionId?: string
  strength?: 1 | 2 | 3
  reason?: string
}

export interface SpeechEnvelope {
  acts: SpeechAct[]
  prose: string
}

function isPersona(v: unknown): v is PersonaId {
  return typeof v === 'string' && (PERSONA_IDS as readonly string[]).includes(v)
}

function parseAct(raw: unknown): SpeechAct | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const kind = o.kind
  if (
    kind !== 'open' &&
    kind !== 'support' &&
    kind !== 'rebut' &&
    kind !== 'revise' &&
    kind !== 'question' &&
    kind !== 'vote'
  ) {
    return null
  }
  const claim =
    typeof o.claim === 'string' && o.claim.trim()
      ? o.claim.trim()
      : typeof o.reason === 'string'
        ? o.reason.trim()
        : ''
  if (!claim && kind !== 'vote') return null
  const act: SpeechAct = { kind, claim: claim || '(vote)' }
  if (isPersona(o.target)) act.target = o.target
  if (typeof o.claimId === 'string') act.claimId = o.claimId
  if (typeof o.attack === 'string') act.attack = o.attack
  if (typeof o.priorClaim === 'string') act.priorClaim = o.priorClaim
  if (typeof o.optionId === 'string') act.optionId = o.optionId
  if (o.strength === 1 || o.strength === 2 || o.strength === 3) act.strength = o.strength
  if (typeof o.reason === 'string') act.reason = o.reason

  // Rebut/support/question without target → demote to open
  if ((kind === 'rebut' || kind === 'support' || kind === 'question') && !act.target) {
    return { kind: 'open', claim: act.claim }
  }
  return act
}

/**
 * Parse advisor model output into SpeechEnvelope.
 * Accepts full JSON envelope, fenced JSON, or plain prose fallback.
 */
export function parseSpeechEnvelope(text: string): SpeechEnvelope {
  const raw = text.trim()
  if (!raw) return { acts: [{ kind: 'open', claim: '…' }], prose: '…' }

  try {
    const obj = extractJsonObject(raw) as Record<string, unknown>
    if (obj && typeof obj === 'object') {
      const prose =
        typeof obj.prose === 'string' && obj.prose.trim()
          ? obj.prose.trim()
          : typeof obj.text === 'string'
            ? obj.text.trim()
            : ''
      const actsRaw = Array.isArray(obj.acts) ? obj.acts : Array.isArray(obj.act) ? [obj.act] : []
      const acts = actsRaw.map(parseAct).filter((a): a is SpeechAct => a != null)
      if (prose || acts.length) {
        return {
          acts: acts.length ? acts.slice(0, 3) : [{ kind: 'open', claim: firstSentence(prose || raw) }],
          prose: prose || raw,
        }
      }
    }
  } catch {
    // fall through
  }

  return {
    acts: [{ kind: 'open', claim: firstSentence(raw) }],
    prose: raw,
  }
}

function firstSentence(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim()
  const m = t.match(/^(.{1,160}?[.!?。！？])/)
  return (m?.[1] ?? t.slice(0, 160)) || '…'
}

/** Format envelope for AgentRun.output (readable + machine tail). */
export function formatSpeechOutput(envelope: SpeechEnvelope): string {
  const actsJson = JSON.stringify({ acts: envelope.acts })
  return `${envelope.prose.trim()}\n\n<!--hip.speech_acts-->\n${actsJson}`
}
