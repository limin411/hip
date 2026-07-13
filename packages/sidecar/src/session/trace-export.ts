/**
 * Trace / observation export (Track E / E2).
 *
 * Langfuse-ish observation records with parent links, plus optional JSONL
 * serialization for loop + subagent events. Default truncation matches
 * `TOOL_BLOB_CAP` for `input`/`output` **and** free-text fields mirrored into
 * `metadata`; full tool / task-output blobs are NOT copied by default.
 *
 * Product path is opt-in: nothing here is wired unless a caller collects
 * observations or calls the export helpers.
 *
 * Lifecycle LoopEvents belong on `GraphEmit.loopSignal` (see
 * `createDebugLoopSignalSink` / `createLoopEventCollector`). Spawn is a span
 * with `parentId` — not a LoopEvent (E0 union frozen); do not feed spawn
 * through loopSignal.
 */

import { clip, TOOL_BLOB_CAP, type TraceRun } from './tool-trace.js'
import type { LoopEvent } from './loop-events.js'
import { emitLoopSignal, type LoopEventSink } from './loop-events.js'
import { logDebug, logObservation } from '../debug-logger.js'

/** Langfuse-ish observation kinds used in JSONL export. */
export type ObservationType = 'span' | 'loop'

/**
 * One exportable observation. `parentId` is the parent agent / observation id
 * (maps from TraceRun.parentAgentId / spawn parentAgentId).
 */
export interface TraceObservation {
  type: ObservationType
  id: string
  /** Parent observation / parent agent id (langfuse parentObservationId analogue). */
  parentId?: string
  name: string
  sessionId?: string
  turnId?: string
  agentId?: string
  startTime?: number
  endTime?: number
  /** Truncated by default (TOOL_BLOB_CAP). */
  input?: string
  /** Truncated by default (TOOL_BLOB_CAP). */
  output?: string
  /**
   * Structured fields. Free-text that also appears in `input` (loop question /
   * reason) is clipped to the same blob cap so JSONL never re-embeds full text.
   */
  metadata?: Record<string, unknown>
  /** True when input and/or output was clipped for export. */
  truncated?: boolean
}

export interface TraceExportOptions {
  /** Max chars for input/output string fields. Default: TOOL_BLOB_CAP. */
  blobCap?: number
  /**
   * When true, skip clipping (still never reads ~/.hip/task-output files).
   * Default false — safe for debug dumps.
   */
  includeFullBlobs?: boolean
}

export interface SubagentSpawnLink {
  sessionId?: string
  turnId?: string
  runId?: string
  agentId: string
  /** Parent agent / observation id. */
  parentAgentId?: string
  /** Task description (will be truncated on export / log). */
  task: string
  depth?: number
  mode?: 'foreground' | 'background'
}

function applyBlob(
  s: string | undefined,
  cap: number,
  includeFull: boolean,
): { text?: string; truncated: boolean } {
  if (s === undefined) return { truncated: false }
  if (includeFull) return { text: s, truncated: false }
  const { text, truncated } = clip(s, cap)
  return { text, truncated }
}

/** Build a span observation for a subagent spawn (parent link + task input). */
export function subagentSpawnObservation(
  link: SubagentSpawnLink,
  opts: TraceExportOptions = {},
): TraceObservation {
  const cap = opts.blobCap ?? TOOL_BLOB_CAP
  const includeFull = opts.includeFullBlobs === true
  const inClip = applyBlob(link.task, cap, includeFull)
  return {
    type: 'span',
    id: link.agentId,
    ...(link.parentAgentId ? { parentId: link.parentAgentId } : {}),
    name: 'subagent.spawn',
    ...(link.sessionId ? { sessionId: link.sessionId } : {}),
    ...(link.turnId ? { turnId: link.turnId } : {}),
    agentId: link.agentId,
    startTime: Date.now(),
    ...(inClip.text !== undefined ? { input: inClip.text } : {}),
    ...(inClip.truncated ? { truncated: true } : {}),
    metadata: {
      ...(link.parentAgentId ? { parentAgentId: link.parentAgentId } : {}),
      ...(link.runId ? { runId: link.runId } : {}),
      ...(link.depth !== undefined ? { depth: link.depth } : {}),
      ...(link.mode ? { mode: link.mode } : {}),
    },
  }
}

/** Flatten live trajectory runs into parent-linked span observations. */
export function trajectoryToObservations(
  trajectory: Map<string, TraceRun>,
  opts: TraceExportOptions = {},
): TraceObservation[] {
  const cap = opts.blobCap ?? TOOL_BLOB_CAP
  const includeFull = opts.includeFullBlobs === true
  const out: TraceObservation[] = []
  for (const [agentId, r] of trajectory) {
    const inClip = applyBlob(r.taskInput, cap, includeFull)
    const outClip = applyBlob(r.output, cap, includeFull)
    const truncated = inClip.truncated || outClip.truncated
    out.push({
      type: 'span',
      id: agentId,
      ...(r.parentAgentId ? { parentId: r.parentAgentId } : {}),
      name: `agent.${r.role}`,
      agentId,
      startTime: r.startedAt,
      ...(r.finishedAt != null ? { endTime: r.finishedAt } : {}),
      ...(inClip.text !== undefined ? { input: inClip.text } : {}),
      ...(outClip.text !== undefined ? { output: outClip.text } : {}),
      ...(truncated ? { truncated: true } : {}),
      metadata: {
        role: r.role,
        seq: r.seq,
        ...(r.parentAgentId ? { parentAgentId: r.parentAgentId } : {}),
        toolCallCount: r.toolCalls.size,
        // Intentionally omit full tool outputs — use tool:started/finished path or opt-in later.
      },
    })
  }
  return sortObservations(out)
}

/**
 * Map internal LoopEvents into exportable observations (no dual-write to SessionEvent).
 * Free-text (`question` / `reason`) is clipped both in `input` and in `metadata`
 * so default export never re-embeds full strings past TOOL_BLOB_CAP.
 */
export function loopEventsToObservations(
  events: LoopEvent[],
  opts: TraceExportOptions = {},
): TraceObservation[] {
  const cap = opts.blobCap ?? TOOL_BLOB_CAP
  const includeFull = opts.includeFullBlobs === true
  return events.map((e, i) => {
    let extra: string | undefined
    if (e.type === 'loop.pause') extra = e.question
    else if (e.type === 'loop.replan') extra = e.reason
    else if (e.type === 'loop.nudge') extra = e.reason
    else if (e.type === 'loop.end') extra = e.reason
    const clipQ = applyBlob(extra, cap, includeFull)

    // Build metadata from the event with free-text keys re-clipped (or omitted when empty).
    const meta: Record<string, unknown> = { type: e.type, sessionId: e.sessionId, turnId: e.turnId }
    if (e.type === 'loop.step') {
      meta.agentId = e.agentId
      meta.step = e.step
      meta.maxSteps = e.maxSteps
    } else if (e.type === 'loop.nudge') {
      meta.reason = clipQ.text ?? e.reason
    } else if (e.type === 'loop.replan') {
      meta.reason = clipQ.text ?? e.reason
    } else if (e.type === 'loop.pause') {
      meta.question = clipQ.text ?? e.question
      if (e.kind) meta.kind = e.kind
    } else if (e.type === 'loop.budget') {
      meta.remaining = e.remaining
      meta.total = e.total
    } else if (e.type === 'loop.end') {
      meta.reason = clipQ.text ?? e.reason
    }

    return {
      type: 'loop' as const,
      id: `loop-${i}-${e.type}`,
      name: e.type,
      sessionId: e.sessionId,
      turnId: e.turnId,
      // Stamp so exportTraceJsonl can merge-sort with trajectory spans.
      startTime: Date.now(),
      ...(e.type === 'loop.step' ? { agentId: e.agentId } : {}),
      ...(clipQ.text !== undefined ? { input: clipQ.text } : {}),
      ...(clipQ.truncated ? { truncated: true } : {}),
      metadata: meta,
    }
  })
}

/**
 * Stable sort by `startTime` ascending, then original index.
 * Observations missing `startTime` sort as 0 (with index as tie-break).
 */
export function sortObservations(observations: TraceObservation[]): TraceObservation[] {
  return observations
    .map((o, i) => ({ o, i }))
    .sort((a, b) => {
      const ta = a.o.startTime ?? 0
      const tb = b.o.startTime ?? 0
      if (ta !== tb) return ta - tb
      return a.i - b.i
    })
    .map(({ o }) => o)
}

/** Serialize observations as newline-delimited JSON (one object per line). */
export function observationsToJsonl(observations: TraceObservation[]): string {
  if (observations.length === 0) return ''
  return observations.map((o) => JSON.stringify(o)).join('\n') + '\n'
}

/**
 * Convenience: trajectory + optional loop events → JSONL string.
 * Defaults to truncated blobs (no secrets dump of full tool output).
 * Rows are globally sorted by `startTime` (stable) for a single timeline.
 */
export function exportTraceJsonl(
  trajectory: Map<string, TraceRun>,
  loopEvents: LoopEvent[] = [],
  opts: TraceExportOptions = {},
): string {
  const obs = sortObservations([
    ...trajectoryToObservations(trajectory, opts),
    ...loopEventsToObservations(loopEvents, opts),
  ])
  return observationsToJsonl(obs)
}

/**
 * Record a subagent parent observation link:
 * 1. `logObservation` (no-op unless HIP_DEBUG=1) with parentId / truncated task.
 * 2. Optional `collect` sink for JSONL / in-memory export.
 *
 * Spawn is **not** a LoopEvent — callers wire lifecycle events to
 * `GraphEmit.loopSignal` separately (see `createDebugLoopSignalSink`).
 *
 * Does not throw. Does not alter product control flow.
 */
export function linkSubagentParentObservation(
  link: SubagentSpawnLink,
  opts?: {
    /** Optional collector for JSONL / in-memory export. */
    collect?: (o: TraceObservation) => void
    exportOpts?: TraceExportOptions
  },
): TraceObservation {
  const obs = subagentSpawnObservation(link, opts?.exportOpts)
  logObservation('subagent.spawn', {
    agentId: link.agentId,
    parentAgentId: link.parentAgentId,
    parentId: link.parentAgentId,
    sessionId: link.sessionId,
    turnId: link.turnId,
    runId: link.runId,
    depth: link.depth,
    mode: link.mode,
    // truncated task preview only — never dump full blobs
    task: obs.input,
    truncated: obs.truncated === true,
  })
  try {
    opts?.collect?.(obs)
  } catch {
    /* collector best-effort */
  }
  return obs
}

/**
 * LoopEventSink that appends into an array (for JSONL export tests / opt-in wiring).
 * Never throws into the agent loop.
 */
export function createLoopEventCollector(into: LoopEvent[]): LoopEventSink {
  return (e) => {
    emitLoopSignal((ev) => {
      into.push(ev)
    }, e)
  }
}

/**
 * LoopEventSink that mirrors events to debug-logger (HIP_DEBUG gated).
 * Safe to assign as GraphEmit.loopSignal for opt-in lifecycle observability.
 * Not used for subagent spawn (spawn is a span via linkSubagentParentObservation).
 */
export function createDebugLoopSignalSink(): LoopEventSink {
  return (e) => {
    try {
      logDebug('loop', e.type, e as unknown as Record<string, unknown>)
    } catch {
      /* ignore */
    }
  }
}
