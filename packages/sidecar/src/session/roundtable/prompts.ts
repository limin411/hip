import type { PersonaId, RoundtableLang, SpeechRecord } from './types.js'
import { PERSONA_IDS } from './types.js'
import { MAX_ADVISORS_PER_ROUND, ROUNDTABLE_ROUNDS_MAX, ROUNDTABLE_ROUNDS_MIN } from './constants.js'

const PERSONA_LABEL: Record<RoundtableLang, Record<PersonaId, string>> = {
  en: {
    strategist: 'Strategist',
    skeptic: 'Skeptic',
    creative: 'Creative',
    operator: 'Operator',
    audience: 'Audience advocate',
  },
  'zh-CN': {
    strategist: '战略家',
    skeptic: '怀疑论者',
    creative: '创意者',
    operator: '执行者',
    audience: '受众倡导者',
  },
  'zh-TW': {
    strategist: '戰略家',
    skeptic: '懷疑論者',
    creative: '創意者',
    operator: '執行者',
    audience: '受眾倡導者',
  },
  ja: {
    strategist: '戦略家',
    skeptic: '懐疑派',
    creative: 'クリエイティブ',
    operator: '実行者',
    audience: 'オーディエンス代弁',
  },
  ko: {
    strategist: '전략가',
    skeptic: '회의론자',
    creative: '크리에이티브',
    operator: '실행자',
    audience: '청중 대변',
  },
}

export function personaLabel(id: PersonaId, lang: RoundtableLang): string {
  return PERSONA_LABEL[lang][id] ?? id
}

export function chairSystemPrompt(lang: RoundtableLang): string {
  return `You are hip — chair and sole decision-maker of a roundtable council.
Each step emit EXACTLY one JSON object (no markdown prose outside JSON) matching one ChairAction:

{"type":"route","convene":false,"reply":"..."} 
{"type":"route","convene":true,"reason":"..."}
{"type":"plan","rounds":2|3|4,"agenda":["..."],"rationale":"..."}
{"type":"open_round","round":1,"focus":"...","speakers":["strategist","skeptic"],"mode":"serial_react"|"parallel_then_synth"}
{"type":"stage","round":1,"agreed":["..."],"open":["..."],"nextFocus":"...","earlyExit":false}
{"type":"decide","decision":"...","residual":["..."],"nextSteps":["..."]}

Rules:
- First action is always route.
- Simple/low-stakes/single-answer → convene false with a normal assistant reply.
- Real tradeoffs/risk/strategy → convene true, then plan, then open_round/stage loop, then decide.
- rounds must be between ${ROUNDTABLE_ROUNDS_MIN} and ${ROUNDTABLE_ROUNDS_MAX}.
- speakers: 1–${MAX_ADVISORS_PER_ROUND} from ${PERSONA_IDS.join(', ')}; prefer 2–3.
- open_round.mode: prefer "parallel_then_synth" for opening positions (speakers generate
  concurrently — better UX). Use "serial_react" when later rounds need rebuttal of prior speech.
- Never role-play all advisors yourself; only emit ChairAction JSON.
- You alone decide the final answer (not a vote).
- Respond in language: ${lang} for any user-facing strings inside JSON.`
}

export function chairUserForRoute(issue: string): string {
  return `User issue:\n${issue}\n\nEmit the first ChairAction: type "route".`
}

export function chairUserForPlan(issue: string, reason?: string): string {
  return `User issue:\n${issue}\n\nConvened${reason ? ` because: ${reason}` : ''}.
Emit ChairAction type "plan" with rounds and agenda.`
}

export function chairUserForOpenRound(args: {
  issue: string
  minutes: string
  round: number
  agendaLine: string
  plannedRounds: number
}): string {
  return `User issue:\n${args.issue}

Minutes so far:
${args.minutes || '(none)'}

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
}): string {
  return `User issue:\n${args.issue}

Full minutes:
${args.minutes || '(none)'}

Emit ChairAction type "decide" with decision, residual disagreements, and nextSteps.`
}

export function advisorSystemPrompt(persona: PersonaId, lang: RoundtableLang): string {
  const label = personaLabel(persona, lang)
  return `You are ${label} in a hip roundtable meeting.
Speak only from your role (2–5 sentences). Address other speakers when relevant.
Do not claim final authority. No tools.

Prefer JSON:
{"prose":"your short speech","acts":[{"kind":"open|support|rebut|revise|question","claim":"...","target":"strategist|skeptic|creative|operator|audience"}]}
Use rebut/support/question with target when reacting to another advisor.
If you cannot emit JSON, plain prose is acceptable.
Language: ${lang}.`
}

export function advisorUserPrompt(args: {
  issue: string
  minutes: string
  focus: string
  priorThisRound: SpeechRecord[]
  persona: PersonaId
  lang: RoundtableLang
}): string {
  const prior =
    args.priorThisRound.length === 0
      ? '(independent take this round — no concurrent speeches yet; react to Minutes if any)'
      : args.priorThisRound.map((s) => `**${s.speaker}:** ${s.content}`).join('\n\n')
  return `Issue:
${args.issue}

Minutes (prior rounds / stage conclusions — treat as what others already said):
${args.minutes || '(none yet)'}

This round focus: ${args.focus}

Prior speeches this round (serial mode only; empty if parallel):
${prior}

You are ${personaLabel(args.persona, args.lang)}. Give your contribution now.
If Minutes or prior speeches exist, explicitly agree or rebut a named persona when relevant.`
}
