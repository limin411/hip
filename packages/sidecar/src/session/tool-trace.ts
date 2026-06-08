import type { AgentRole, AgentRun, ServerMessage, ToolCall, ToolStatus } from '@hip/protocol'

export const TOOL_BLOB_CAP = 4096

/** Clip a blob to the cap and report whether it was shortened. */
export function clip(s: string, cap = TOOL_BLOB_CAP): { text: string; truncated: boolean } {
  return s.length > cap ? { text: s.slice(0, cap), truncated: true } : { text: s, truncated: false }
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
    const seq = ctx.nextSeq()
    const inClip = clip(stringify(tc.input))
    ctx.record.start(agentId, tc.callId, tc.name, inClip.text, seq, inClip.truncated)
    ctx.send({ type: 'tool:started', sessionId: ctx.sessionId, agentId, callId: tc.callId, name: tc.name, input: inClip.text, seq, ...(inClip.truncated ? { truncated: true } : {}) })
    ctx.pending.push((async () => {
      try {
        const status = await tc.status
        if (status === 'error') {
          const error = await tc.error
          ctx.record.finish(agentId, tc.callId, 'error', undefined, error, false)
          ctx.send({ type: 'tool:finished', sessionId: ctx.sessionId, agentId, callId: tc.callId, status: 'error', ...(error ? { error } : {}) })
        } else {
          const outClip = clip(stringify(await tc.output))
          ctx.record.finish(agentId, tc.callId, 'finished', outClip.text, undefined, outClip.truncated)
          ctx.send({ type: 'tool:finished', sessionId: ctx.sessionId, agentId, callId: tc.callId, status: 'finished', output: outClip.text, ...(outClip.truncated ? { truncated: true } : {}) })
        }
      } catch {
        // aborted / stream torn down — leave the record non-terminal; trajectoryToRuns coerces it.
      }
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
