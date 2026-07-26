import {
  CHAIR_PARSE_RETRIES,
  MAX_ADVISORS_PER_ROUND,
  ROUNDTABLE_ROUNDS_MAX,
  ROUNDTABLE_ROUNDS_MIN,
} from './constants.js'
import { resolveCast } from './persona-briefs.js'
import {
  PERSONA_IDS,
  type CastSeat,
  type ChairAction,
  type DecideConfidence,
  type PersonaId,
  type RoundtableLang,
} from './types.js'

function isPersonaId(v: unknown): v is PersonaId {
  return typeof v === 'string' && (PERSONA_IDS as readonly string[]).includes(v)
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((s) => s.trim())
}

/** Extract first JSON object from model text (fenced or bare). */
export function extractJsonObject(text: string): unknown {
  const raw = text.trim()
  if (!raw) throw new Error('empty chair response')
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fence ? fence[1]!.trim() : raw
  try {
    return JSON.parse(body)
  } catch {
    const start = body.indexOf('{')
    const end = body.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(body.slice(start, end + 1))
    }
    throw new Error('chair response is not JSON')
  }
}

/**
 * Parse cast without lang fill (schema is lang-agnostic).
 * Runner should call resolveCast for L1 fill; here we keep raw-ish seats for plan action.
 */
export function parseCastRaw(raw: unknown): CastSeat[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const seen = new Set<PersonaId>()
  const seats: CastSeat[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    if (!isPersonaId(o.id) || seen.has(o.id)) continue
    seen.add(o.id)
    const title = typeof o.title === 'string' ? o.title.trim() : ''
    const lens = typeof o.lens === 'string' ? o.lens.trim() : ''
    const mustCover = asStringArray(o.mustCover).slice(0, 6)
    const mustNot = asStringArray(o.mustNot).slice(0, 6)
    seats.push({
      id: o.id,
      title,
      lens,
      mustCover,
      ...(mustNot.length ? { mustNot } : {}),
    })
    if (seats.length >= MAX_ADVISORS_PER_ROUND) break
  }
  return seats.length ? seats : undefined
}

/** Derive a short verdict from a long decision body when model omitted verdict. */
export function deriveVerdictFromDecision(decision: string, maxLen = 280): string {
  const t = decision.trim()
  if (!t) return ''
  const firstLine = t.split(/\n+/).map((l) => l.trim()).find((l) => l.length > 0) ?? t
  const cleaned = firstLine.replace(/^#+\s*/, '').replace(/^\*\*(.+)\*\*$/, '$1').trim()
  if (cleaned.length <= maxLen) return cleaned
  return cleaned.slice(0, maxLen - 1).trimEnd() + '…'
}

function parseConfidence(v: unknown): DecideConfidence | undefined {
  if (v === 'high' || v === 'medium' || v === 'low') return v
  return undefined
}

export interface ParseChairOptions {
  /** Language for resolveCast fill when attaching normalized cast on plan. Default en. */
  lang?: RoundtableLang
  /**
   * When true (default for decide): empty verdict throws so chair retries.
   * Set softVerdict to derive from decision instead of throwing.
   */
  softVerdict?: boolean
}

export function parseChairAction(raw: unknown, opts: ParseChairOptions = {}): ChairAction {
  if (!raw || typeof raw !== 'object') throw new Error('chair action not an object')
  const o = raw as Record<string, unknown>
  const type = o.type
  if (type === 'route') {
    const convene = Boolean(o.convene)
    if (!convene) {
      const reply = typeof o.reply === 'string' ? o.reply.trim() : ''
      if (!reply) throw new Error('route skip requires reply')
      return { type: 'route', convene: false, reply }
    }
    return {
      type: 'route',
      convene: true,
      ...(typeof o.reason === 'string' && o.reason.trim() ? { reason: o.reason.trim() } : {}),
    }
  }
  if (type === 'plan') {
    let rounds = Number(o.rounds)
    if (!Number.isFinite(rounds)) throw new Error('plan.rounds invalid')
    rounds = Math.min(ROUNDTABLE_ROUNDS_MAX, Math.max(ROUNDTABLE_ROUNDS_MIN, Math.floor(rounds)))
    const agenda = asStringArray(o.agenda)
    const rationale = typeof o.rationale === 'string' ? o.rationale.trim() : ''
    while (agenda.length < rounds) agenda.push(`Round ${agenda.length + 1}`)
    const trimmed = agenda.slice(0, rounds)
    const castRaw = parseCastRaw(o.cast)
    // Always attach normalized cast for runners that expect it on the action.
    const lang = opts.lang ?? 'en'
    const cast = resolveCast(castRaw ?? o.cast, lang)
    return {
      type: 'plan',
      rounds: rounds as 2 | 3 | 4,
      agenda: trimmed,
      rationale: rationale || 'Complexity warrants multi-round discussion.',
      cast,
    }
  }
  if (type === 'open_round') {
    const round = Number(o.round)
    if (!Number.isFinite(round) || round < 1) throw new Error('open_round.round invalid')
    const focus = typeof o.focus === 'string' ? o.focus.trim() : ''
    if (!focus) throw new Error('open_round.focus required')
    const speakersRaw = Array.isArray(o.speakers) ? o.speakers : []
    const speakers: PersonaId[] = []
    for (const s of speakersRaw) {
      if (isPersonaId(s) && !speakers.includes(s)) speakers.push(s)
      if (speakers.length >= MAX_ADVISORS_PER_ROUND) break
    }
    if (speakers.length === 0) speakers.push('strategist', 'skeptic')
    const modeRaw = o.mode
    const mode =
      modeRaw === 'parallel_then_synth' ? ('parallel_then_synth' as const) : ('serial_react' as const)
    return {
      type: 'open_round',
      round: Math.floor(round),
      focus,
      speakers,
      mode,
    }
  }
  if (type === 'stage') {
    const round = Number(o.round)
    if (!Number.isFinite(round) || round < 1) throw new Error('stage.round invalid')
    const agreed = asStringArray(o.agreed)
    const open = asStringArray(o.open)
    const earlyExit = Boolean(o.earlyExit)
    const nextFocus = typeof o.nextFocus === 'string' ? o.nextFocus.trim() : undefined
    const earlyExitReason =
      typeof o.earlyExitReason === 'string' ? o.earlyExitReason.trim() : undefined
    return {
      type: 'stage',
      round: Math.floor(round),
      agreed,
      open,
      ...(nextFocus ? { nextFocus } : {}),
      ...(earlyExit ? { earlyExit: true } : {}),
      ...(earlyExitReason ? { earlyExitReason } : {}),
    }
  }
  if (type === 'decide') {
    const decision = typeof o.decision === 'string' ? o.decision.trim() : ''
    if (!decision) throw new Error('decide.decision required')
    let verdict = typeof o.verdict === 'string' ? o.verdict.trim() : ''
    if (!verdict) {
      if (opts.softVerdict) {
        verdict = deriveVerdictFromDecision(decision)
      } else {
        throw new Error('decide.verdict required')
      }
    }
    if (!verdict) throw new Error('decide.verdict required')
    const confidence = parseConfidence(o.confidence)
    return {
      type: 'decide',
      verdict,
      decision,
      keyTradeoffs: asStringArray(o.keyTradeoffs),
      residual: asStringArray(o.residual),
      nextSteps: asStringArray(o.nextSteps),
      ...(confidence ? { confidence } : {}),
    }
  }
  throw new Error(`unknown chair action type: ${String(type)}`)
}

export function parseChairActionFromText(text: string, opts: ParseChairOptions = {}): ChairAction {
  return parseChairAction(extractJsonObject(text), opts)
}

export { CHAIR_PARSE_RETRIES }
