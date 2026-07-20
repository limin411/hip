import type { AgentRole, AgentRun, ServerMessage, TimelineStep, ToolCall, ToolStatus } from '@hip/protocol'

export const TOOL_BLOB_CAP = 4096

/**
 * Higher cap for subagent/delegate tool I/O on the UI/DB wire path so parent
 * task/dispatch_agent/task_batch results are not mutilated to 4KB.
 */
export const DELEGATE_BLOB_CAP = 32_768

/** Tool names whose input/output use {@link DELEGATE_BLOB_CAP} when clipping for transport. */
export const DELEGATE_CLIP_TOOLS = new Set([
  'task',
  'dispatch_agent',
  'task_batch',
  'task_retry',
  'task_output',
  'task_stop',
])

/** Clip a blob to the cap and report whether it was shortened. */
export function clip(s: string, cap = TOOL_BLOB_CAP): { text: string; truncated: boolean } {
  return s.length > cap ? { text: s.slice(0, cap), truncated: true } : { text: s, truncated: false }
}

/** Clip tool input/output using a higher cap for delegate tools. */
export function clipForTool(
  toolName: string,
  s: string,
): { text: string; truncated: boolean } {
  const cap = DELEGATE_CLIP_TOOLS.has(toolName) ? DELEGATE_BLOB_CAP : TOOL_BLOB_CAP
  return clip(s, cap)
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

/** One contiguous burst of supervisor assistant text (mirrors ReasoningBurst; no clip — content is authoritative). */
export interface TextBurst {
  stepSeq: number
  content: string
  truncated?: boolean
}

/**
 * Tracks one open reasoning burst per agent during a turn. A burst opens on the agent's
 * first delta (claiming the next turn-global stepSeq), accumulates subsequent deltas, and
 * is closed (clipped to REASONING_CAP) into a ReasoningBurst when a tool fires or the agent
 * finishes. Pure: the caller owns emitting reasoning:delta and pushing the closed burst.
 */
export class ReasoningTracker {
  private open = new Map<string, { stepSeq: number; content: string }>()
  constructor(private readonly nextSeq: () => number) {}

  /** Append a delta for an agent, opening a burst (drawing a stepSeq) if none is open. Returns the burst's stepSeq. */
  push(agentId: string, delta: string): number {
    let b = this.open.get(agentId)
    if (!b) { b = { stepSeq: this.nextSeq(), content: '' }; this.open.set(agentId, b) }
    b.content += delta
    return b.stepSeq
  }

  /** Close the agent's open burst into a clipped ReasoningBurst, or undefined if none is open. */
  close(agentId: string): ReasoningBurst | undefined {
    const b = this.open.get(agentId)
    if (!b) return undefined
    this.open.delete(agentId)
    const { text, truncated } = clipReasoning(b.content)
    return { stepSeq: b.stepSeq, content: text, ...(truncated ? { truncated: true } : {}) }
  }
}

/**
 * Tracks open supervisor text bursts during a turn (KD-17 Choice A).
 * Callers must only push/close for the turn supervisor (`agentId === 'supervisor'` on the hub).
 * Subagent tokens never enter this tracker. Mirrors {@link ReasoningTracker} for stepSeq ordering.
 * Text is not clipped: closed bursts become authoritative Message.content via contentFromTimeline.
 */
export class TextBurstTracker {
  private open = new Map<string, { stepSeq: number; content: string }>()
  constructor(private readonly nextSeq: () => number) {}

  /** Append a delta, opening a burst (drawing a stepSeq) if none is open. Returns the burst's stepSeq. */
  push(agentId: string, delta: string): number {
    let b = this.open.get(agentId)
    if (!b) {
      b = { stepSeq: this.nextSeq(), content: '' }
      this.open.set(agentId, b)
    }
    b.content += delta
    return b.stepSeq
  }

  /** Close the agent's open burst into a TextBurst, or undefined if none is open. */
  close(agentId: string): TextBurst | undefined {
    const b = this.open.get(agentId)
    if (!b) return undefined
    this.open.delete(agentId)
    return { stepSeq: b.stepSeq, content: b.content }
  }

  /** Close every open burst (turn finalize). */
  closeAll(): Array<{ agentId: string } & TextBurst> {
    const out: Array<{ agentId: string } & TextBurst> = []
    for (const agentId of [...this.open.keys()]) {
      const burst = this.close(agentId)
      if (burst) out.push({ agentId, ...burst })
    }
    return out
  }
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
  /**
   * Closed supervisor text bursts (KD-17). Only the hub supervisor should push here;
   * trajectoryToTimeline emits kind:'text' solely from supervisor textBursts.
   */
  textBursts?: TextBurst[]
  taskInput?: string
  /**
   * Who delegated this run (observation parent). Used by trajectoryToRuns and
   * JSONL export (`parentId` on TraceObservation). Prefer setting this at
   * agent:started / ensureStarted time so export parent links stay accurate.
   */
  parentAgentId?: string
  /** Human-facing agent name (e.g. "Coder"); surfaced in UI instead of generic role labels. */
  name?: string
}

/** Callbacks the pump uses to mutate the owning session's trajectory. */
export interface TraceRecorder {
  start(agentId: string, callId: string, name: string, input: string, seq: number, truncated: boolean): void
  finish(agentId: string, callId: string, status: 'finished' | 'error', output: string | undefined, error: string | undefined, truncated: boolean): void
}

export interface ConsumeCtx {
  sessionId: string
  turnId: string
  send: (msg: ServerMessage) => void
  nextSeq: () => number
  /** Resolve an agent's role for the tool:started event (defaults to 'supervisor' if unknown). */
  roleOf: (agentId: string) => AgentRole
  /** Called before assigning a tool's stepSeq so the session can close any open reasoning burst. */
  onToolStart: (agentId: string) => void
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
    // Close any open reasoning burst BEFORE this tool claims the next stepSeq, so the
    // burst's stepSeq stays strictly below the tool's in the turn-global ordering.
    ctx.onToolStart(agentId)
    const seq = ctx.nextSeq()
    const inClip = clipForTool(tc.name, stringify(tc.input))
    ctx.record.start(agentId, tc.callId, tc.name, inClip.text, seq, inClip.truncated)
    ctx.send({ type: 'tool:started', sessionId: ctx.sessionId, turnId: ctx.turnId, agentId, role: ctx.roleOf(agentId), callId: tc.callId, name: tc.name, input: inClip.text, seq, ...(inClip.truncated ? { truncated: true } : {}) })
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
          const outClip = clipForTool(tc.name, stringify(await tc.output))
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
      ctx.send({ type: 'tool:finished', sessionId: ctx.sessionId, turnId: ctx.turnId, agentId, callId: tc.callId, status, ...(output !== undefined ? { output } : {}), ...(error ? { error } : {}), ...(truncated ? { truncated: true } : {}) })
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
    ...(r.name ? { name: r.name } : {}),
    toolCalls: [...r.toolCalls.values()]
      .sort((a, b) => a.seq - b.seq)
      .map((tc): ToolCall => (tc.status === 'running' ? { ...tc, status: 'error' as ToolStatus, error: tc.error ?? 'interrupted' } : tc)),
  }))
}

/**
 * Flatten the live trajectory into a single turn-ordered timeline. Emit each run's reasoning
 * bursts (kind:'reasoning'), tool calls (kind:'tool', stepSeq = toolCall.seq), and
 * supervisor-only text bursts (kind:'text', KD-17), then sort by the shared turn-global
 * stepSeq ascending.
 */
export function trajectoryToTimeline(trajectory: Map<string, TraceRun>): TimelineStep[] {
  const steps: TimelineStep[] = []
  for (const [agentId, r] of trajectory) {
    // Text steps: supervisor only (agentId or role). Drop any mistaken non-supervisor textBursts.
    if (agentId === 'supervisor' || r.role === 'supervisor') {
      for (const b of r.textBursts ?? []) {
        steps.push({
          kind: 'text',
          stepSeq: b.stepSeq,
          agentId,
          role: r.role,
          content: b.content,
          ...(b.truncated ? { truncated: true } : {}),
        })
      }
    }
    for (const b of r.reasoningBursts) {
      steps.push({ kind: 'reasoning', stepSeq: b.stepSeq, agentId, role: r.role, content: b.content, ...(b.truncated ? { truncated: true } : {}) })
    }
    for (const tc of r.toolCalls.values()) {
      steps.push({ kind: 'tool', stepSeq: tc.seq, agentId, role: r.role, callId: tc.callId })
    }
  }
  return steps.sort((a, b) => a.stepSeq - b.stepSeq)
}

/**
 * Authoritative assistant body from timeline text steps (KD-17).
 * Joins supervisor `kind:'text'` steps by stepSeq. Non-supervisor text is ignored as a belt-and-suspenders guard.
 */
export function contentFromTimeline(steps: TimelineStep[]): string {
  return steps
    .filter((s): s is Extract<TimelineStep, { kind: 'text' }> => s.kind === 'text')
    .filter((s) => s.agentId === 'supervisor' || s.role === 'supervisor')
    .sort((a, b) => a.stepSeq - b.stepSeq)
    .map((s) => s.content)
    .join('')
}
