import {
  CHAIR_PARSE_RETRIES,
  MAX_ADVISORS_PER_ROUND,
  ROUNDTABLE_ROUNDS_MAX,
  ROUNDTABLE_ROUNDS_MIN,
} from './constants.js'
import { PERSONA_IDS, type ChairAction, type PersonaId } from './types.js'

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

export function parseChairAction(raw: unknown): ChairAction {
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
    // Pad / trim agenda to rounds
    while (agenda.length < rounds) agenda.push(`Round ${agenda.length + 1}`)
    const trimmed = agenda.slice(0, rounds)
    return {
      type: 'plan',
      rounds: rounds as 2 | 3 | 4,
      agenda: trimmed,
      rationale: rationale || 'Complexity warrants multi-round discussion.',
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
    return {
      type: 'open_round',
      round: Math.floor(round),
      focus,
      speakers,
      mode: 'serial_react',
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
    return {
      type: 'decide',
      decision,
      residual: asStringArray(o.residual),
      nextSteps: asStringArray(o.nextSteps),
    }
  }
  throw new Error(`unknown chair action type: ${String(type)}`)
}

export function parseChairActionFromText(text: string): ChairAction {
  return parseChairAction(extractJsonObject(text))
}

export { CHAIR_PARSE_RETRIES }
