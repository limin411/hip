// src/domain/sessionStore/messageUtils.ts
import type {
  AgentRole,
  AgentRun,
  Message,
  TimelineStep,
  ToolCall,
} from '@hip/protocol'

export function coerceRunningToolCalls(toolCalls: ToolCall[] | undefined): ToolCall[] | undefined {
  if (!toolCalls?.some((tc) => tc.status === 'running')) return toolCalls
  return toolCalls.map((tc) => (tc.status === 'running' ? { ...tc, status: 'error' as const, error: tc.error ?? 'interrupted' } : tc))
}

/** Index of the last `role === 'assistant'` message (from the tail); -1 if none.
 *  Ignores trailing `notice` rows so cancel / streaming / regenerate target the real turn. */
export function lastAssistantIndex(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') return i
  }
  return -1
}

/** Last message that is not a system notice (transparent for turn-boundary checks). */
export function lastNonNotice(messages: Message[]): Message | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== 'notice') return messages[i]
  }
  return undefined
}

/** True when `messages[index]` is the last assistant of the open turn: last assistant index
 *  and no newer user after it (notices after the assistant are OK). Used for regenerate /
 *  isLastAssistant and as the base for isStreamingAssistant. */
export function isCurrentTurnAssistant(messages: Message[], index: number): boolean {
  if (messages[index]?.role !== 'assistant') return false
  if (index !== lastAssistantIndex(messages)) return false
  for (let i = index + 1; i < messages.length; i++) {
    if (messages[i].role === 'user') return false
  }
  return true
}

/** True when `messages[index]` is the in-flight streaming assistant for the current turn. */
export function isStreamingAssistant(
  messages: Message[],
  index: number,
  status: string,
): boolean {
  if (status !== 'running') return false
  return isCurrentTurnAssistant(messages, index)
}

/** Drop trailing assistant + notice messages until a user (or empty). Used by regenerate. */
export function popForRegenerate(messages: Message[]): Message[] {
  const next = [...messages]
  while (next.length > 0) {
    const r = next[next.length - 1].role
    if (r === 'assistant' || r === 'notice') next.pop()
    else break
  }
  return next
}

/** On cancel, finalize the in-flight last assistant message (ignoring trailing notice): drop it if
 *  it's a fully empty provisional (no content/timeline/tools), else if it is still in-flight
 *  (empty content OR has running tools) coerce tools to error and mark it stopped.
 *  Prior completed turns are left alone. */
export function finalizeCancelledMessage(messages: Message[]): Message[] {
  const idx = lastAssistantIndex(messages)
  if (idx === -1) return messages
  const m = messages[idx]
  const empty = m.content === '' && !(m.timeline?.length) && !(m.toolCalls?.length)
  if (empty) return messages.filter((_, k) => k !== idx)
  const inFlight = m.content === '' || !!m.toolCalls?.some((tc) => tc.status === 'running')
  if (!inFlight) return messages // prior completed turn — leave alone
  return mapMessages(messages, (x) =>
    x.id === m.id ? { ...x, toolCalls: coerceRunningToolCalls(x.toolCalls), stopped: true } : x,
  )
}

/** Build a freshly-started ToolCall from a tool:started message. */
export function makeRunningToolCall(msg: { callId: string; agentId: string; name: string; input: string; seq: number; truncated?: boolean }): ToolCall {
  return { callId: msg.callId, agentId: msg.agentId, name: msg.name, input: msg.input, status: 'running', seq: msg.seq, ...(msg.truncated ? { truncated: true } : {}) }
}

/** Apply a tool:finished patch to an existing ToolCall (sticky-OR truncated). */
export function patchFinishedToolCall(tc: ToolCall, msg: { status: 'finished' | 'error'; output?: string; error?: string; truncated?: boolean }): ToolCall {
  return { ...tc, status: msg.status, ...(msg.output !== undefined ? { output: msg.output } : {}), ...(msg.error !== undefined ? { error: msg.error } : {}), ...(tc.truncated || msg.truncated ? { truncated: true } : {}) }
}

/**
 * Map over messages while preserving **array identity** when every element is
 * referentially unchanged. Unchanged message objects are always kept as-is
 * (`fn` should return the same ref when nothing mutates). This lets React.memo
 * on MessageBubble skip re-renders for prior turns during stream/tool updates.
 */
export function mapMessages(messages: Message[], fn: (m: Message) => Message): Message[] {
  let changed = false
  const next = messages.map((m) => {
    const m2 = fn(m)
    if (m2 !== m) changed = true
    return m2
  })
  return changed ? next : messages
}

/** Ensure the provisional assistant message keyed by turnId exists (idempotent).
 *  Invariant v2: stream/tool/reasoning/complete only mutate `message.id === turnId` (not the list tail).
 *  agent:started creates the provisional; notice rows may trail the turn without breaking addressing. */
export function ensureAssistantMessage(messages: Message[], turnId: string, agentId: string, now: number): Message[] {
  if (messages.some((m) => m.id === turnId)) return messages
  return [...messages, { id: turnId, role: 'assistant', content: '', agentId, timestamp: now, timeline: [], toolCalls: [] }]
}

/** Upsert a reasoning step on the turn's message: same stepSeq concatenates the delta. No-op if the turn is unknown. */
export function upsertReasoning(messages: Message[], turnId: string, step: { stepSeq: number; agentId: string; role: AgentRole; delta: string }): Message[] {
  if (!messages.some((m) => m.id === turnId)) return messages
  return mapMessages(messages, (m) => {
    if (m.id !== turnId) return m
    const timeline = m.timeline ?? []
    const exists = timeline.some((t) => t.kind === 'reasoning' && t.stepSeq === step.stepSeq)
    const nextTimeline = exists
      ? timeline.map((t) => (t.kind === 'reasoning' && t.stepSeq === step.stepSeq ? { ...t, content: t.content + step.delta } : t))
      : [...timeline, { kind: 'reasoning' as const, stepSeq: step.stepSeq, agentId: step.agentId, role: step.role, content: step.delta }]
    return { ...m, timeline: nextTimeline }
  })
}

/**
 * Upsert a supervisor text step (KD-17): same stepSeq concatenates the delta.
 * Non-supervisor agentId/role is a defensive no-op (subagent tokens must never become text steps).
 */
export function upsertTimelineText(
  messages: Message[],
  turnId: string,
  step: { stepSeq: number; agentId: string; role: AgentRole; delta: string },
): Message[] {
  const isSupervisor = step.agentId === 'supervisor' || step.role === 'supervisor'
  if (!isSupervisor) return messages
  if (!messages.some((m) => m.id === turnId)) return messages
  return messages.map((m) => {
    if (m.id !== turnId) return m
    const timeline = m.timeline ?? []
    const exists = timeline.some((t) => t.kind === 'text' && t.stepSeq === step.stepSeq)
    const nextTimeline = exists
      ? timeline.map((t) => (t.kind === 'text' && t.stepSeq === step.stepSeq ? { ...t, content: t.content + step.delta } : t))
      : [...timeline, { kind: 'text' as const, stepSeq: step.stepSeq, agentId: step.agentId, role: step.role, content: step.delta } satisfies TimelineStep]
    return { ...m, timeline: nextTimeline }
  })
}

/** Append supervisor token delta to the message with `id === turnId`. No-op if the turn is unknown. */
export function appendAssistantDelta(messages: Message[], turnId: string, delta: string): Message[] {
  if (!messages.some((m) => m.id === turnId)) return messages
  return mapMessages(messages, (m) => (m.id === turnId ? { ...m, content: m.content + delta } : m))
}


/** Upsert an AgentRun onto the turn's assistant message (keyed by turnId). No-op if the turn is unknown.
 *  Assigns a provisional insertion-order seq on append; preserves the prior seq on replace.
 *  (message:complete later overwrites runs with the sidecar's authoritative seqs.) */
export function upsertRun(messages: Message[], turnId: string, run: AgentRun): Message[] {
  if (!messages.some((m) => m.id === turnId)) return messages
  return mapMessages(messages, (m) => {
    if (m.id !== turnId) return m
    const runs = m.agentRuns ?? []
    const i = runs.findIndex((r) => r.agentId === run.agentId)
    return i >= 0
      ? { ...m, agentRuns: runs.map((r, k) => (k === i ? { ...run, seq: r.seq } : r)) }
      : { ...m, agentRuns: [...runs, { ...run, seq: runs.length }] }
  })
}

/** Append a delta to a subagent run's output on the turn's message (keyed by turnId). No-op if unknown. */
export function appendRunOutput(messages: Message[], turnId: string, agentId: string, delta: string): Message[] {
  return mapMessages(messages, (m) =>
    m.id !== turnId || !m.agentRuns
      ? m
      : { ...m, agentRuns: m.agentRuns.map((r) => (r.agentId === agentId ? { ...r, output: r.output + delta } : r)) },
  )
}

/** Set finishedAt on the run for the given turn + agent. */
export function setRunFinished(messages: Message[], turnId: string, agentId: string, now: number): Message[] {
  return mapMessages(messages, (m) =>
    m.id !== turnId || !m.agentRuns
      ? m
      : { ...m, agentRuns: m.agentRuns.map((r) => (r.agentId === agentId ? { ...r, finishedAt: now } : r)) },
  )
}

/** Replace the message with matching `message.id`, or append if not found (never relies on list tail). */
export function finalizeAssistant(messages: Message[], message: Message): Message[] {
  const idx = messages.findIndex((m) => m.id === message.id)
  if (idx >= 0) return mapMessages(messages, (m) => (m.id === message.id ? message : m))
  return [...messages, message]
}

