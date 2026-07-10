import type { AgentRole, Message, TimelineStep, ToolCall } from '@hip/protocol'

/** Per-turn, per-agent activity bucket derived from a Message's timeline + toolCalls + agentRuns. */
export interface GroupedTurn {
  messageId: string
  turnIndex: number
  timestamp: number
  agents: TurnAgent[]
}

export interface TurnAgent {
  agentId: string
  role: AgentRole
  reasoning: string
  tools: ToolCall[]
  /** running while live; error when tools failed or empty-error output; else done */
  status: 'running' | 'done' | 'error'
  output: string
  elapsedMs: number
  taskInput?: string
  parentAgentId?: string
  /** Total tokens for this agent run when provider reported usage */
  totalTokens?: number
  /** Owning assistant message id (for scroll-to-turn) */
  messageId?: string
}

function deriveAgentStatus(
  live: boolean,
  run: { finishedAt: number | null; output?: string } | undefined,
  tools: ToolCall[],
  messageStopped?: boolean,
): TurnAgent['status'] {
  if (live && run != null && run.finishedAt == null) return 'running'
  const toolFailed = tools.some((tc) => tc.status === 'error')
  const out = run?.output ?? ''
  const emptyOrError =
    (messageStopped && !out.trim()) ||
    out.trimStart().startsWith('Error:') ||
    out.includes('Error: sub-agent produced empty') ||
    out.includes('Error: dispatched agent produced empty')
  if (toolFailed || emptyOrError) return 'error'
  return 'done'
}

/**
 * Group a turn's flat timeline + toolCalls + agentRuns into per-agent buckets.
 * Unions agents from the timeline (in appearance order) with agents that only have a run
 * (e.g. an output-only subagent), so none are dropped. reasoning/tools come from the timeline;
 * status/timing/taskInput/parentAgentId/output come from the matching run. Derived OUTSIDE any
 * Zustand selector (returns a fresh array).
 */
export function groupByAgent(message: Message | null, live: boolean): TurnAgent[] {
  if (!message) return []
  const steps: TimelineStep[] = message.timeline ?? []
  const runs = message.agentRuns ?? []
  const runByAgent = new Map(runs.map((r) => [r.agentId, r]))
  const toolByCallId = new Map((message.toolCalls ?? []).map((tc) => [tc.callId, tc]))
  const order: string[] = []
  const buckets = new Map<string, { role: AgentRole; reasoning: string[]; tools: ToolCall[] }>()
  const ensure = (agentId: string, role: AgentRole) => {
    let b = buckets.get(agentId)
    if (!b) { b = { role, reasoning: [], tools: [] }; buckets.set(agentId, b); order.push(agentId) }
    return b
  }
  for (const step of [...steps].sort((a, b) => a.stepSeq - b.stepSeq)) {
    const b = ensure(step.agentId, step.role)
    if (step.kind === 'reasoning') b.reasoning.push(step.content)
    else { const tc = toolByCallId.get(step.callId); if (tc) b.tools.push(tc) }
  }
  for (const r of runs) ensure(r.agentId, r.role) // output-only agents
  return order.map((agentId) => {
    const b = buckets.get(agentId)!
    const run = runByAgent.get(agentId)
    const status = deriveAgentStatus(live, run, b.tools, message.stopped)
    const elapsedMs = run && run.finishedAt != null ? run.finishedAt - run.startedAt : 0
    const totalTokens = run?.usage?.totalTokens
    return {
      agentId,
      role: b.role,
      reasoning: b.reasoning.join('\n\n'),
      tools: b.tools,
      status,
      output: run?.output ?? '',
      elapsedMs,
      messageId: message.id,
      ...(run?.taskInput ? { taskInput: run.taskInput } : {}),
      ...(run?.parentAgentId ? { parentAgentId: run.parentAgentId } : {}),
      ...(typeof totalTokens === 'number' ? { totalTokens } : {}),
    }
  })
}

/**
 * Group all assistant messages across the conversation into per-turn agent buckets.
 * Filters to assistant-role messages only; skips those with no agent activity
 * (no timeline, no toolCalls, and no agentRuns). turnIndex starts at 1 and increments
 * for each included message. The last assistant message is marked live=true for
 * groupByAgent only when sessionStatus === 'running'.
 */
export function groupAllAgents(messages: Message[], sessionStatus: string): GroupedTurn[] {
  const assistantMessages = messages.filter((m) => m.role === 'assistant')
  const result: GroupedTurn[] = []
  let turnIndex = 1

  for (let i = 0; i < assistantMessages.length; i++) {
    const msg = assistantMessages[i]
    const hasTimeline = (msg.timeline?.length ?? 0) > 0
    const hasToolCalls = (msg.toolCalls?.length ?? 0) > 0
    const hasAgentRuns = (msg.agentRuns?.length ?? 0) > 0

    if (!hasTimeline && !hasToolCalls && !hasAgentRuns) continue

    const isLast = i === assistantMessages.length - 1
    const live = isLast && sessionStatus === 'running'

    result.push({
      messageId: msg.id,
      turnIndex,
      timestamp: msg.timestamp,
      agents: groupByAgent(msg, live),
    })

    turnIndex++
  }

  return result
}
