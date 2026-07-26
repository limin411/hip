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

export interface RoundtableEdgeResult {
  round: number
  from: string
  to: string
  relation: 'support' | 'rebut' | 'question'
  summary: string
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
  /** Council discussion edges */
  edges?: RoundtableEdgeResult[]
}

export interface RoundtableCompleteFns {
  /** Raw model completion (system + user → text). */
  complete: (args: {
    system: string
    user: string
    signal: AbortSignal
    tag: string
    /** Live text deltas (used by council to stream into Agents panel). */
    onText?: (delta: string) => void
  }) => Promise<string>
}

export interface AdvisorSpeechHooks {
  onStart: (p: {
    speaker: PersonaId
    round: number
    focus: string
    agentId: string
  }) => void | Promise<void>
  /** Stream partial advisor text into FE agentRuns (token:stream). */
  onToken?: (p: { agentId: string; delta: string }) => void
  onFinish: (p: {
    speaker: PersonaId
    round: number
    focus: string
    agentId: string
    content: string
    prose: string
  }) => void | Promise<void>
}

export interface RunRoundtableArgs {
  issue: string
  language?: RoundtableLang | string | null
  signal: AbortSignal
  llm: RoundtableCompleteFns
  onEvent?: (ev: RoundtableEvent) => void
  /** Stream visible markdown chunks (for token:stream). */
  onMarkdownDelta?: (delta: string) => void
  /** Parse SpeechEnvelope + collect edges (council). */
  councilMode?: boolean
  /** Project multi-agent lifecycle (council → agent:started/finished). */
  advisorHooks?: AdvisorSpeechHooks
  /**
   * Real advisor delegation (managed agent). When set, used instead of llm.complete
   * for advisor speeches so each seat is a true nested agent run.
   */
  runAdvisor?: (args: {
    speaker: PersonaId
    system: string
    user: string
    signal: AbortSignal
    round: number
    focus: string
    agentId: string
  }) => Promise<string>
  roundsMin?: number
  roundsMax?: number
  maxAdvisorsPerRound?: number
  maxAdvisorCalls?: number
  maxChairActions?: number
  /** Wall-clock budget for the whole meeting (default 180s). */
  wallClockMs?: number
}
