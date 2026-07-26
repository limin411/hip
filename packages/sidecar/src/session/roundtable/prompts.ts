import type {
  CastSeat,
  PersonaId,
  RoundtableLang,
  SpeechRecord,
} from './types.js'
import { PERSONA_IDS } from './types.js'
import {
  MAX_ADVISORS_PER_ROUND,
  ROUNDTABLE_ROUNDS_MAX,
  ROUNDTABLE_ROUNDS_MIN,
} from './constants.js'
import {
  getPersonaBrief,
  personaLabelFromBrief,
  seatTitle,
} from './persona-briefs.js'

export function personaLabel(id: PersonaId, lang: RoundtableLang): string {
  return personaLabelFromBrief(id, lang)
}

export function chairSystemPrompt(lang: RoundtableLang): string {
  return `You are hip — chair and sole decision-maker of a roundtable council.
Each step emit EXACTLY one JSON object (no markdown prose outside JSON) matching one ChairAction:

{"type":"route","convene":false,"reply":"..."} 
{"type":"route","convene":true,"reason":"..."}
{"type":"plan","rounds":2|3|4,"agenda":["..."],"rationale":"...","cast":[{"id":"strategist|skeptic|creative|operator|audience","title":"issue-specific title","lens":"how this seat views THIS issue","mustCover":["..."],"mustNot":["optional"]}]}
{"type":"open_round","round":1,"focus":"...","speakers":["strategist","skeptic"],"mode":"serial_react"|"parallel_then_synth"}
{"type":"stage","round":1,"agreed":["..."],"open":["..."],"nextFocus":"...","earlyExit":false}
{"type":"decide","verdict":"1-3 sentence core answer","decision":"structured body: adopted/rejected/boundaries","keyTradeoffs":["..."],"residual":["..."],"nextSteps":["actionable steps"],"confidence":"high"|"medium"|"low"}

Rules:
- First action is always route.
- Simple/low-stakes/single-answer → convene false with a normal assistant reply.
- Real tradeoffs/risk/strategy → convene true, then plan, then open_round/stage loop, then decide.
- rounds must be between ${ROUNDTABLE_ROUNDS_MIN} and ${ROUNDTABLE_ROUNDS_MAX}.
- plan.cast (strongly preferred when convening):
  - 2–${MAX_ADVISORS_PER_ROUND} seats; each id MUST be one of: ${PERSONA_IDS.join(', ')}.
  - Prefer complementary lenses for THIS issue (not always all five; 3–5 is fine).
  - title and lens MUST be issue-specific (not generic role names only).
  - mustCover: 1–4 concrete questions/angles for this meeting.
- speakers on open_round: subset of cast ids (or all cast). Prefer parallel_then_synth.
- Never role-play all advisors yourself; only emit ChairAction JSON.
- You alone decide the final answer (not a vote). Advisors never hold final authority.
- decide quality bar (mandatory):
  1) verdict first: standalone 1–3 sentences a busy reader can act on without the transcript.
  2) decision body: what was adopted / rejected / hard boundaries; name seats when resolving conflicts.
  3) keyTradeoffs: what was sacrificed.
  4) nextSteps: actionable (verb + object); not a restatement of the issue.
  5) Do not only restate minutes — resolve open items or put them in residual.
- Respond in language: ${lang} for any user-facing strings inside JSON.`
}

export function chairUserForRoute(issue: string): string {
  return `User issue:\n${issue}\n\nEmit the first ChairAction: type "route".`
}

export function chairUserForPlan(issue: string, reason?: string): string {
  return `User issue:\n${issue}\n\nConvened${reason ? ` because: ${reason}` : ''}.
Emit ChairAction type "plan" with rounds, agenda, rationale, and cast.
Cast: choose 2–${MAX_ADVISORS_PER_ROUND} complementary seats from ${PERSONA_IDS.join(', ')} with issue-specific title, lens, and mustCover for THIS issue.`
}

export function chairUserForOpenRound(args: {
  issue: string
  minutes: string
  round: number
  agendaLine: string
  plannedRounds: number
  cast?: CastSeat[]
}): string {
  const castHint =
    args.cast && args.cast.length
      ? `\nMeeting cast (speakers must be from these ids):\n${args.cast
          .map((s) => `- ${s.id}: ${s.title} — ${s.lens}`)
          .join('\n')}\n`
      : ''
  return `User issue:\n${args.issue}

Minutes so far:
${args.minutes || '(none)'}
${castHint}
Planned rounds: ${args.plannedRounds}. Now open round ${args.round}.
Agenda hint: ${args.agendaLine}

Emit ChairAction type "open_round" for round ${args.round} with focus and speakers.`
}

export function chairUserForStage(args: {
  issue: string
  minutes: string
  round: number
  plannedRounds: number
  speeches: SpeechRecord[]
}): string {
  const body = args.speeches.map((s) => `**${s.speaker}:** ${s.content}`).join('\n\n')
  return `User issue:\n${args.issue}

Minutes:
${args.minutes || '(none)'}

Round ${args.round} speeches:
${body || '(none)'}

Planned rounds: ${args.plannedRounds}. Emit ChairAction type "stage" for round ${args.round}.
If more rounds remain and disagreement is not decision-critical, you may earlyExit.
If round ${args.round} is the last planned round, do not earlyExit; wrap open items for decide.`
}

export function chairUserForDecide(args: {
  issue: string
  minutes: string
  cast?: CastSeat[]
}): string {
  const castHint =
    args.cast && args.cast.length
      ? `\nSeats that spoke (titles):\n${args.cast.map((s) => `- ${s.id}: ${s.title}`).join('\n')}\n`
      : ''
  return `User issue:\n${args.issue}
${castHint}
Full minutes:
${args.minutes || '(none)'}

Emit ChairAction type "decide" meeting the quality bar:
- verdict: 1–3 sentence core conclusion (standalone)
- decision: structured body (adopted / rejected / boundaries); cite seats on conflicts
- keyTradeoffs: explicit sacrifices
- residual: unresolved disagreements
- nextSteps: actionable steps
- confidence: high | medium | low (optional)

Do not only restate the minutes.`
}

export function chairUserForDecideQualityRetry(args: {
  issue: string
  minutes: string
  priorJsonHint: string
  failures: string[]
  cast?: CastSeat[]
}): string {
  return `${chairUserForDecide({ issue: args.issue, minutes: args.minutes, cast: args.cast })}

Previous decide failed the quality bar:
${args.failures.map((f) => `- ${f}`).join('\n')}

Prior attempt (for reference; improve it):
${args.priorJsonHint.slice(0, 2000)}

Re-emit a stronger type "decide" JSON only.`
}

export interface AdvisorPromptContext {
  persona: PersonaId
  lang: RoundtableLang
  issue: string
  agenda: string[]
  focus: string
  minutes: string
  priorThisRound: SpeechRecord[]
  seat: CastSeat
}

/** L1+L2+L3 advisor system prompt. */
export function advisorSystemPrompt(ctx: AdvisorPromptContext | PersonaId, lang?: RoundtableLang): string {
  // Backward-compatible: advisorSystemPrompt(persona, lang)
  if (typeof ctx === 'string') {
    const persona = ctx
    const L = lang ?? 'en'
    const brief = getPersonaBrief(persona)
    const seat: CastSeat = {
      id: persona,
      title: brief.label[L] ?? brief.label.en,
      lens: brief.mission[L] ?? brief.mission.en,
      mustCover: [...(brief.typicalProbes[L] ?? brief.typicalProbes.en)],
      mustNot: [...(brief.mustNot[L] ?? brief.mustNot.en)],
    }
    return buildAdvisorSystem({ persona, lang: L, seat })
  }
  return buildAdvisorSystem(ctx)
}

function buildAdvisorSystem(args: {
  persona: PersonaId
  lang: RoundtableLang
  seat: CastSeat
}): string {
  const baseLabel = personaLabel(args.persona, args.lang)
  const title = args.seat.title || baseLabel
  const lens = args.seat.lens
  const mustCover = (args.seat.mustCover ?? []).map((x) => `- ${x}`).join('\n') || '- (use your role judgment)'
  const mustNotList = [
    ...(args.seat.mustNot ?? []),
    args.lang === 'zh-CN' || args.lang === 'zh-TW'
      ? '自称最终拍板权（由 hip 决定）'
      : 'Claim final authority — hip decides',
  ]
  const mustNot = mustNotList.map((x) => `- ${x}`).join('\n')

  return `You are ${title} (base seat: ${baseLabel}) in a hip roundtable meeting.
Mission / lens for THIS issue:
${lens}

You MUST cover when relevant:
${mustCover}

You MUST NOT:
${mustNot}

Speak from your lens (typically 2–8 sentences after any research). Address other speakers by base seat id when relevant.
Do not claim final authority — hip decides.

Tools you MAY use when facts matter:
- web_search / web_fetch — look up current or external facts before arguing
- read_file / ls / glob / grep — only if local project context is needed
Do NOT attempt write/edit/run_script or spawn further agents.

When you use search, briefly cite what you found in your prose (source or fact).

Prefer ending with JSON (or prose + JSON fence):
{"prose":"your short speech","acts":[{"kind":"open|support|rebut|revise|question","claim":"...","target":"strategist|skeptic|creative|operator|audience"}]}
Use rebut/support/question with target when reacting to another advisor.
If you cannot emit JSON, plain prose is acceptable.
Language: ${args.lang}.`
}

/** L2+L3 advisor user prompt. */
export function advisorUserPrompt(
  args: AdvisorPromptContext | {
    issue: string
    minutes: string
    focus: string
    priorThisRound: SpeechRecord[]
    persona: PersonaId
    lang: RoundtableLang
    agenda?: string[]
    seat?: CastSeat
  },
): string {
  const seat =
    'seat' in args && args.seat
      ? args.seat
      : {
          id: args.persona,
          title: seatTitle(args.persona, args.lang),
          lens: getPersonaBrief(args.persona).mission[args.lang],
          mustCover: [...getPersonaBrief(args.persona).typicalProbes[args.lang]],
          mustNot: [...getPersonaBrief(args.persona).mustNot[args.lang]],
        }
  const agenda = ('agenda' in args && args.agenda) || []
  const prior =
    args.priorThisRound.length === 0
      ? '(independent take this round — no concurrent speeches yet; react to Minutes if any)'
      : args.priorThisRound.map((s) => `**${s.speaker}:** ${s.content}`).join('\n\n')
  const agendaBlock =
    agenda.length > 0
      ? agenda.map((a, i) => `${i + 1}. ${a}`).join('\n')
      : '(none listed)'
  const mustCover = (seat.mustCover ?? []).map((x) => `- ${x}`).join('\n') || '- (use judgment for this focus)'

  return `Issue:
${args.issue}

Agenda (full meeting):
${agendaBlock}

Minutes (prior rounds / stage conclusions — treat as what others already said):
${args.minutes || '(none yet)'}

This round focus: ${args.focus}

Prior speeches this round (serial mode only; empty if parallel):
${prior}

Your seat: ${seat.title} (${args.persona})
Lens: ${seat.lens}
Must respond to / cover this meeting when relevant:
${mustCover}

Give your contribution now from your lens only.
If Minutes or prior speeches exist, explicitly agree or rebut a named persona (base id) when relevant.`
}

/** Structural quality failures for decide (empty = pass). */
export function decideQualityFailures(d: {
  verdict: string
  decision: string
  nextSteps: string[]
}): string[] {
  const fails: string[] = []
  if (d.verdict.trim().length < 12) fails.push('verdict too short (<12 chars)')
  if (d.decision.trim().length < 40) fails.push('decision body too short (<40 chars)')
  if (!d.nextSteps.length) fails.push('nextSteps empty')
  return fails
}
