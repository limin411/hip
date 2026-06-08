import type { AgentRole, AgentRun, ServerMessage, TimelineStep, ToolCall, ToolStatus } from '@hip/protocol'

export const TOOL_BLOB_CAP = 4096

/** Clip a blob to the cap and report whether it was shortened. */
export function clip(s: string, cap = TOOL_BLOB_CAP): { text: string; truncated: boolean } {
  return s.length > cap ? { text: s.slice(0, cap), truncated: true } : { text: s, truncated: false }
}

// Reasoning traces are far longer than tool blobs; cap generously (32 KB) to keep
// most of a turn's chain-of-thought while still bounding per-message DB growth.
export const REASONING_CAP = 32768

/** Clip an agent's reasoning burst to REASONING_CAP, reusing the blob-clip pattern. */
export function clipReasoning(s: string): { text: string; truncated: boolean } {
  return clip(s, REASONING_CAP)
}

/** One contiguous burst of reasoning deltas from a single agent. */
export interface ReasoningBurst {
  stepSeq: number
  content: string
  truncated?: boolean
}

/** Stringify a tool arg/result for transport + storage. Strings pass through. */
export function stringify(v: unknown): string {
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v) ?? String(v)
  } catch {
    return String(v)
  }
}

/** Structural subset of deepagents/langgraph ToolCallStream we depend on (so tests can fake it). */
export interface ToolCallStreamLike {
  name: string
  callId: string
  input: unknown
  output: Promise<unknown>
  status: Promise<'running' | 'finished' | 'error'>
  error: Promise<string | undefined>
}

/** Sidecar-side mutable record of one agent's run, including its tool calls keyed by callId. */
export interface TraceRun {
  role: AgentRole
  output: string
  startedAt: number
  finishedAt: number | null
  seq: number
  toolCalls: Map<string, ToolCall>
  reasoningBursts: ReasoningBurst[]
  taskInput?: string
  parentAgentId?: string
}

/** Callbacks the pump uses to mutate the owning session's trajectory. */
export interface TraceRecorder {
  start(agentId: string, callId: string, name: string, input: string, seq: number, truncated: boolean): void
  finish(agentId: string, callId: string, status: 'finished' | 'error', output: string | undefined, error: string | undefined, truncated: boolean): void
}

export interface ConsumeCtx {
  sessionId: string
  send: (msg: ServerMessage) => void
  nextSeq: () => number
  pending: Promise<void>[]
  record: TraceRecorder
}

/**
 * Consume one agent's ToolCallStream iterable. Emits tool:started synchronously
 * (input is available immediately), then resolves the result Promises OFF the
 * critical path (pushed to ctx.pending) so the iterator never stalls. `task`
 * delegations are filtered — they are represented via agent:started instead.
 */
export async function consumeToolCalls(agentId: string, toolCalls: AsyncIterable<ToolCallStreamLike>, ctx: ConsumeCtx): Promise<void> {
  for await (const tc of toolCalls) {
    if (tc.name === 'task') continue
    // The result Promises are created eagerly by the stream and may reject on tool-error or
    // stream teardown. Attach no-op catches up front so branches that don't await them (the
    // error path, the non-terminal return) and aborts that bypass them never leak an unhandled
    // rejection. The awaits below still read the settled values independently.
    void Promise.resolve(tc.output).catch(() => {})
    void Promise.resolve(tc.error).catch(() => {})
    const seq = ctx.nextSeq()
    const inClip = clip(stringify(tc.input))
    ctx.record.start(agentId, tc.callId, tc.name, inClip.text, seq, inClip.truncated)
    ctx.send({ type: 'tool:started', sessionId: ctx.sessionId, agentId, callId: tc.callId, name: tc.name, input: inClip.text, seq, ...(inClip.truncated ? { truncated: true } : {}) })
    ctx.pending.push((async () => {
      // Resolve the result Promises OFF the critical path. Only the awaits are inside the try
      // (so a torn-down/aborted stream is tolerated); record.finish/send run AFTER it, so a bug
      // in them propagates instead of being silently swallowed.
      let status: 'finished' | 'error'
      let output: string | undefined
      let error: string | undefined
      let truncated = false
      try {
        const resolved = await tc.status
        if (resolved === 'error') {
          status = 'error'
          error = await tc.error
        } else if (resolved === 'finished') {
          status = 'finished'
          const outClip = clip(stringify(await tc.output))
          output = outClip.text
          truncated = outClip.truncated
        } else {
          // Non-terminal status (should not happen for a resolved stream) — leave the record
          // running; trajectoryToRuns coerces it to error at finalize.
          return
        }
      } catch {
        // aborted / stream torn down — leave the record non-terminal; trajectoryToRuns coerces it.
        return
      }
      ctx.record.finish(agentId, tc.callId, status, output, error, truncated)
      ctx.send({ type: 'tool:finished', sessionId: ctx.sessionId, agentId, callId: tc.callId, status, ...(output !== undefined ? { output } : {}), ...(error ? { error } : {}), ...(truncated ? { truncated: true } : {}) })
    })())
  }
}

/** Convert the live trajectory into persistable AgentRun[]. Sorts tool calls by seq and
 *  coerces any tool still 'running' (interrupted) to 'error' so the DB has no dangling state. */
export function trajectoryToRuns(trajectory: Map<string, TraceRun>): AgentRun[] {
  return [...trajectory.entries()].map(([agentId, r]) => ({
    agentId,
    role: r.role,
    output: r.output,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    seq: r.seq,
    ...(r.taskInput ? { taskInput: r.taskInput } : {}),
    ...(r.parentAgentId ? { parentAgentId: r.parentAgentId } : {}),
    toolCalls: [...r.toolCalls.values()]
      .sort((a, b) => a.seq - b.seq)
      .map((tc): ToolCall => (tc.status === 'running' ? { ...tc, status: 'error' as ToolStatus, error: tc.error ?? 'interrupted' } : tc)),
  }))
}

/**
 * Flatten the live trajectory into a single turn-ordered timeline. Emit each run's reasoning
 * bursts (kind:'reasoning', carrying the burst's stepSeq) and tool calls (kind:'tool',
 * stepSeq = toolCall.seq), then sort by the shared turn-global stepSeq ascending.
 */
export function trajectoryToTimeline(trajectory: Map<string, TraceRun>): TimelineStep[] {
  const steps: TimelineStep[] = []
  for (const [agentId, r] of trajectory) {
    for (const b of r.reasoningBursts) {
      steps.push({ kind: 'reasoning', stepSeq: b.stepSeq, agentId, role: r.role, content: b.content, ...(b.truncated ? { truncated: true } : {}) })
    }
    for (const tc of r.toolCalls.values()) {
      steps.push({ kind: 'tool', stepSeq: tc.seq, agentId, role: r.role, callId: tc.callId })
    }
  }
  return steps.sort((a, b) => a.stepSeq - b.stepSeq)
}
