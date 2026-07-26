export type PersonaId =
  | 'strategist'
  | 'skeptic'
  | 'creative'
  | 'operator'
  | 'audience'

export const PERSONA_IDS: readonly PersonaId[] = [
  'strategist',
  'skeptic',
  'creative',
  'operator',
  'audience',
] as const

export type RoundtableLang = 'en' | 'zh-CN' | 'zh-TW' | 'ja' | 'ko'

export type RoundtablePhase =
  | 'routing'
  | 'normal_reply'
  | 'planning'
  | 'round_open'
  | 'advisor_speaking'
  | 'stage_conclude'
  | 'deciding'
  | 'done'
  | 'aborted'

export type ChairAction =
  | { type: 'route'; convene: false; reply: string }
  | { type: 'route'; convene: true; reason?: string }
  | {
      type: 'plan'
      rounds: 2 | 3 | 4
      agenda: string[]
      rationale: string
    }
  | {
      type: 'open_round'
      round: number
      focus: string
      speakers: PersonaId[]
      /** serial_react (default): each speaker sees prior this round. parallel_then_synth: all concurrent. */
      mode?: 'serial_react' | 'parallel_then_synth'
    }
  | {
      type: 'stage'
      round: number
      agreed: string[]
      open: string[]
      nextFocus?: string
      earlyExit?: boolean
      earlyExitReason?: string
    }
  | {
      type: 'decide'
      decision: string
      residual: string[]
      nextSteps: string[]
    }

export type RoundtableEvent =
  | { kind: 'roundtable.route'; convene: boolean; reason?: string }
  | {
      kind: 'roundtable.plan'
      rounds: number
      agenda: string[]
      rationale: string
    }
  | {
      kind: 'roundtable.round_open'
      round: number
      focus: string
      speakers: PersonaId[]
    }
  | {
      kind: 'roundtable.speech'
      round: number
      speaker: PersonaId
      content: string
    }
  | {
      kind: 'roundtable.stage'
      round: number
      agreed: string[]
      open: string[]
      earlyExit?: boolean
      earlyExitReason?: string
      nextFocus?: string
    }
  | {
      kind: 'roundtable.decide'
      decision: string
      residual: string[]
      nextSteps: string[]
    }
  | {
      kind: 'roundtable.done'
      earlyExit?: boolean
      advisorCalls: number
      convened: boolean
    }
  | { kind: 'roundtable.aborted'; reason?: string }
  | { kind: 'roundtable.normal_reply'; content: string }

export interface SpeechRecord {
  speaker: PersonaId
  content: string
}

export interface StageRecord {
  round: number
  agreed: string[]
  open: string[]
  earlyExit?: boolean
  earlyExitReason?: string
  nextFocus?: string
}

export interface RoundtableResult {
  phase: 'done' | 'aborted'
  convened: boolean
  markdown: string
  advisorCalls: number
  chairActions: number
  earlyExit?: boolean
  roundsPlanned?: number
  roundsRan?: number
  abortReason?: string
}

export interface RoundtableCompleteFns {
  /** Raw model completion (system + user → text). */
  complete: (args: {
    system: string
    user: string
    signal: AbortSignal
    tag: string
  }) => Promise<string>
}

export interface RunRoundtableArgs {
  issue: string
  language?: RoundtableLang | string | null
  signal: AbortSignal
  llm: RoundtableCompleteFns
  onEvent?: (ev: RoundtableEvent) => void
  /** Stream visible markdown chunks (for token:stream). */
  onMarkdownDelta?: (delta: string) => void
  roundsMin?: number
  roundsMax?: number
  maxAdvisorsPerRound?: number
  maxAdvisorCalls?: number
  maxChairActions?: number
  /** Wall-clock budget for the whole meeting (default 180s). */
  wallClockMs?: number
}
