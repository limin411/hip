/**
 * Real managed-agent delegation for council seats.
 * Advisors may use research tools (web_search / web_fetch + read-only FS) so claims
 * can be grounded in network facts; no write/exec tools.
 */
import type { GraphEmit } from '../graph.js'
import { runManagedAgent } from '../internal-runner.js'
import type { ModelRunner } from '../model-runner.js'
import type { Summarizer } from '../compaction.js'
import type { NetworkPolicy } from '../network-policy.js'
import type { PersonaId, RoundtableLang } from './types.js'
import { councilAgentId, councilDisplayName } from './ids.js'
import { advisorSystemPrompt } from './prompts.js'
import type { CastSeat } from './types.js'

/** Research-oriented allow-list: network + read-only local. No write/exec/delegation. */
export const COUNCIL_ADVISOR_TOOLS = [
  'web_search',
  'web_fetch',
  'read_file',
  'ls',
  'glob',
  'grep',
] as const

export interface CouncilAdvisorDeps {
  runner: ModelRunner
  summarizer: Summarizer
  sessionId: string
  turnId: string
  cwd: string
  language: RoundtableLang
  signal: AbortSignal
  networkPolicy?: NetworkPolicy
  /** Wire to FE (must include agent:started before first token). */
  onAgentStart: (p: {
    agentId: string
    name: string
    persona: PersonaId
    focus: string
  }) => void
  onToken: (agentId: string, delta: string) => void
  /** Optional tool lifecycle for Agents panel / trajectory. */
  onToolStarted?: (p: {
    agentId: string
    callId: string
    name: string
    input: string
  }) => void
  onToolFinished?: (p: {
    agentId: string
    callId: string
    status: 'finished' | 'error'
    output?: string
    error?: string
  }) => void
  onAgentFinish: (p: {
    agentId: string
    name: string
    persona: PersonaId
    text: string
  }) => void
}

/**
 * Spawn one council advisor as a managed agent (depth-1, research tools only).
 * Returns final assistant text.
 */
export async function runCouncilAdvisor(
  deps: CouncilAdvisorDeps,
  opts: {
    persona: PersonaId
    task: string
    focus: string
    /** L1+L2+L3 system prompt from runner; falls back to base L1 if omitted. */
    system?: string
    /** L3 cast title for Agents panel. */
    displayName?: string
    cast?: CastSeat[] | null
  },
): Promise<string> {
  const agentId = councilAgentId(opts.persona)
  const name =
    opts.displayName?.trim() ||
    councilDisplayName(opts.persona, deps.language, opts.cast)
  const system =
    opts.system?.trim() || advisorSystemPrompt(opts.persona, deps.language)

  deps.onAgentStart({ agentId, name, persona: opts.persona, focus: opts.focus })

  let toolSeq = 0
  const emit: GraphEmit = {
    token: (delta) => {
      if (delta) deps.onToken(agentId, delta)
    },
    reasoning: () => {},
    toolStarted: (name, callId, input) => {
      toolSeq++
      deps.onToolStarted?.({
        agentId,
        callId,
        name,
        input: typeof input === 'string' ? input : JSON.stringify(input ?? {}),
      })
    },
    toolFinished: (callId, status, output, error) => {
      deps.onToolFinished?.({
        agentId,
        callId,
        status,
        ...(output !== undefined
          ? { output: typeof output === 'string' ? output : JSON.stringify(output) }
          : {}),
        ...(error ? { error } : {}),
      })
    },
    usage: () => {},
    planDelta: () => {},
    compaction: () => {},
  }
  void toolSeq

  try {
    const text = await runManagedAgent({
      resolved: null,
      cwd: deps.cwd,
      prompt: system,
      task: opts.task,
      emit,
      signal: deps.signal,
      // Extra steps for search → read → speak
      childMaxSteps: 10,
      allowedTools: [...COUNCIL_ADVISOR_TOOLS],
      permissionMode: 'chat',
      sessionId: deps.sessionId,
      turnId: deps.turnId,
      agentId,
      parentAgentId: 'supervisor',
      runner: deps.runner,
      summarizer: deps.summarizer,
      ...(deps.networkPolicy ? { networkPolicy: deps.networkPolicy } : {}),
    })
    const out = (text ?? '').trim() || '…'
    deps.onAgentFinish({ agentId, name, persona: opts.persona, text: out })
    return out
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    const out = deps.signal.aborted ? '…' : `Error: ${err}`
    deps.onAgentFinish({ agentId, name, persona: opts.persona, text: out })
    if (deps.signal.aborted) throw e
    return out
  }
}
