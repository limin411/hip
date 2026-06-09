import type { AgentRole, Message, TimelineStep, ToolCall } from '@hip/protocol'

/** Per-turn, per-agent activity bucket derived from a Message's timeline + toolCalls + agentRuns. */
export interface TurnAgent {
  agentId: string
  role: AgentRole
  reasoning: string
  tools: ToolCall[]
  status: 'running' | 'done'
  output: string
  elapsedMs: number
  taskInput?: string
  parentAgentId?: string
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
    const status: 'running' | 'done' = live && run != null && run.finishedAt == null ? 'running' : 'done'
    const elapsedMs = run && run.finishedAt != null ? run.finishedAt - run.startedAt : 0
    return {
      agentId,
      role: b.role,
      reasoning: b.reasoning.join('\n\n'),
      tools: b.tools,
      status,
      output: run?.output ?? '',
      elapsedMs,
      ...(run?.taskInput ? { taskInput: run.taskInput } : {}),
      ...(run?.parentAgentId ? { parentAgentId: run.parentAgentId } : {}),
    }
  })
}
