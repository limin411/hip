/**
 * Real managed-agent delegation for council seats (not fake complete-only projection).
 * Uses runManagedAgent with zero tools so each persona is a true subagent run
 * with agentId/parentAgentId and GraphEmit streaming — same class as task/dispatch workers.
 */
import type { AgentRole } from '@hip/protocol'
import type { GraphEmit } from '../graph.js'
import { runManagedAgent } from '../internal-runner.js'
import type { ModelRunner } from '../model-runner.js'
import type { Summarizer } from '../compaction.js'
import type { PersonaId, RoundtableLang } from './types.js'
import { councilAgentId, councilDisplayName } from './ids.js'
import { advisorSystemPrompt } from './prompts.js'

export interface CouncilAdvisorDeps {
  runner: ModelRunner
  summarizer: Summarizer
  sessionId: string
  turnId: string
  cwd: string
  language: RoundtableLang
  signal: AbortSignal
  /** Wire to FE (must include agent:started before first token). */
  onAgentStart: (p: {
    agentId: string
    name: string
    persona: PersonaId
    focus: string
  }) => void
  onToken: (agentId: string, delta: string) => void
  onAgentFinish: (p: {
    agentId: string
    name: string
    persona: PersonaId
    text: string
  }) => void
}

/**
 * Spawn one council advisor as a managed agent (depth-1, no tools).
 * Returns final assistant text.
 */
export async function runCouncilAdvisor(
  deps: CouncilAdvisorDeps,
  opts: {
    persona: PersonaId
    task: string
    focus: string
  },
): Promise<string> {
  const agentId = councilAgentId(opts.persona)
  const name = councilDisplayName(opts.persona, deps.language)
  const system = advisorSystemPrompt(opts.persona, deps.language)

  deps.onAgentStart({ agentId, name, persona: opts.persona, focus: opts.focus })

  const emit: GraphEmit = {
    token: (delta) => {
      if (delta) deps.onToken(agentId, delta)
    },
    reasoning: () => {},
    toolStarted: () => {},
    toolFinished: () => {},
    usage: () => {},
    planDelta: () => {},
    compaction: () => {},
  }

  try {
    const text = await runManagedAgent({
      resolved: null,
      cwd: deps.cwd,
      prompt: system,
      task: opts.task,
      emit,
      signal: deps.signal,
      childMaxSteps: 4,
      // Explicit empty allow-list → tool-free debate agent
      allowedTools: [],
      permissionMode: 'chat',
      sessionId: deps.sessionId,
      turnId: deps.turnId,
      agentId,
      parentAgentId: 'supervisor',
      runner: deps.runner,
      summarizer: deps.summarizer,
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

export type { AgentRole }
