/**
 * Trace / observation export (Track E / E2).
 *
 * Langfuse-ish observation records with parent links, plus optional JSONL
 * serialization for loop + subagent events. Default truncation matches
 * `TOOL_BLOB_CAP`; full tool / task-output blobs are NOT copied by default.
 *
 * Product path is opt-in: nothing here is wired unless a caller collects
 * observations or calls the export helpers.
 */

import { clip, TOOL_BLOB_CAP, type TraceRun } from './tool-trace.js'
import type { LoopEvent } from './loop-events.js'
import { emitLoopSignal, type LoopEventSink } from './loop-events.js'
import { logDebug, logObservation } from '../debug-logger.js'

/** Langfuse-ish observation kinds used in JSONL export. */
export type ObservationType = 'span' | 'event' | 'loop'

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
  return out.sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0))
}

/** Map internal LoopEvents into exportable observations (no dual-write to SessionEvent). */
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
    return {
      type: 'loop' as const,
      id: `loop-${i}-${e.type}`,
      name: e.type,
      sessionId: e.sessionId,
      turnId: e.turnId,
      ...(e.type === 'loop.step' ? { agentId: e.agentId } : {}),
      ...(clipQ.text !== undefined ? { input: clipQ.text } : {}),
      ...(clipQ.truncated ? { truncated: true } : {}),
      metadata: { ...e },
    }
  })
}

/** Serialize observations as newline-delimited JSON (one object per line). */
export function observationsToJsonl(observations: TraceObservation[]): string {
  if (observations.length === 0) return ''
  return observations.map((o) => JSON.stringify(o)).join('\n') + '\n'
}

/**
 * Convenience: trajectory + optional loop events → JSONL string.
 * Defaults to truncated blobs (no secrets dump of full tool output).
 */
export function exportTraceJsonl(
  trajectory: Map<string, TraceRun>,
  loopEvents: LoopEvent[] = [],
  opts: TraceExportOptions = {},
): string {
  const obs = [
    ...trajectoryToObservations(trajectory, opts),
    ...loopEventsToObservations(loopEvents, opts),
  ]
  return observationsToJsonl(obs)
}

/**
 * Record a subagent parent observation link:
 * 1. Always `logDebug` (no-op unless HIP_DEBUG=1).
 * 2. Prefer `GraphEmit.loopSignal` when present — only for lifecycle LoopEvents;
 *    spawn itself is not a LoopEvent, so we log the link and optionally push to
 *    an external observation collector.
 * 3. Returns the span observation (callers / tests can collect into JSONL).
 *
 * Does not throw. Does not alter product control flow.
 */
export function linkSubagentParentObservation(
  link: SubagentSpawnLink,
  opts?: {
    /** Optional collector for JSONL / in-memory export. */
    collect?: (o: TraceObservation) => void
    /**
     * When set, used only if the caller wants loopSignal-adjacent visibility;
     * spawn is logged via debug, not as a LoopEvent (LoopEvent union is frozen E0).
     */
    loopSignal?: LoopEventSink
    exportOpts?: TraceExportOptions
  },
): TraceObservation {
  const obs = subagentSpawnObservation(link, opts?.exportOpts)
  // Always attempt structured debug log (HIP_DEBUG-gated). Prefer loopSignal for
  // lifecycle LoopEvents elsewhere; spawn is a span with parentId, not a LoopEvent.
  logObservation('subagent.spawn', {
    agentId: link.agentId,
    parentAgentId: link.parentAgentId,
    parentId: link.parentAgentId,
    sessionId: link.sessionId,
    turnId: link.turnId,
    runId: link.runId,
    depth: link.depth,
    mode: link.mode,
    loopSignalAttached: opts?.loopSignal != null,
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
 * Safe to assign as GraphEmit.loopSignal for opt-in observability.
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
