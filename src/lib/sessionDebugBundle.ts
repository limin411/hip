import type { Message, PlanItem, SessionConfig, TimelineStep } from '@hip/protocol'

/** Tool-error preview length in analysis (not a runtime cap). */
const ERROR_PREVIEW = 240
/** Max tool-error rows retained in analysis.summary. */
const MAX_ERROR_ROWS = 40

export type SessionDebugUiState = {
  status?: string
  planApprovalPending?: boolean
  interrupt?: { turnId: string; question: string; context?: string } | null
  activeTurnPlan?: PlanItem[] | null
  forcePlan?: boolean
}

export type SessionDebugAnalysis = {
  messageCount: number
  userTurns: number
  assistantTurns: number
  stoppedTurns: number
  toolCallCount: number
  toolErrorCount: number
  toolsByName: Record<string, number>
  planToolCounts: {
    EnterPlanMode: number
    ExitPlanMode: number
    write_todos: number
  }
  /** Compact list of tool failures for plan/HITL postmortems. */
  toolErrors: Array<{
    messageId: string
    name: string
    callId?: string
    status?: string
    preview: string
  }>
  /** Wall-clock deltas between consecutive messages (ms), when timestamps exist. */
  messageGapsMs: number[]
}

export type SessionDebugBundle = {
  /** v3 adds session.ui + analysis for plan/HITL postmortems. */
  version: 3
  exportedAt: string
  appVersion?: string
  session: {
    id: string
    title: string
    surface?: string
    cwd?: string
    config: Record<string, unknown>
    /** Runtime knobs useful for parallel-scheduling / perf diagnosis. */
    runtime?: {
      subagentMaxConcurrency: number
      toolParallelismDefault: number
    }
    /** Live UI/session flags at export time (plan approval, interrupt, etc.). */
    ui?: SessionDebugUiState
  }
  messages: Array<{
    id: string
    role: string
    content: string
    agentId?: string
    stopped?: boolean
    timestamp?: number
    toolCalls?: unknown[]
    agentRuns?: unknown[]
    timeline?: unknown[]
    /** Per-message derived flags for faster offline scans. */
    meta?: {
      toolCount: number
      toolErrorCount: number
      toolNames: string[]
      hasExitPlanMode?: boolean
      hasEnterPlanMode?: boolean
      durationMs?: number
    }
  }>
  analysis?: SessionDebugAnalysis
  recentErrors?: Array<{ code?: string; message: string; at?: number }>
}

const SENSITIVE_KEY = /api[_-]?key|token|authorization|password|secret|credential/i
/** Message body / agent-run output cap for clipboard debug exports. */
export const MAX_CONTENT = 12_000
/**
 * Per tool-call field cap. Kept well above the old 2KB export clip so bug dumps
 * retain usable code snippets; marker text distinguishes export vs runtime caps.
 */
export const MAX_TOOL_FIELD = 16_384

/** Default toolParallelism used by graph toolsNode when unset. */
const DEFAULT_TOOL_PARALLELISM = 5
/**
 * Default HIP_SUBAGENT_MAX_CONCURRENCY (must match sidecar subagent-batch).
 * Renderer cannot read sidecar process env; this is the product default for diagnosis.
 */
const DEFAULT_SUBAGENT_MAX_CONCURRENCY = 4

function redactValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEY.test(key)) return '[redacted]'
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return redactObject(value as Record<string, unknown>)
  }
  if (Array.isArray(value)) {
    return value.map((v, i) => redactValue(String(i), v))
  }
  return value
}

export function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    out[k] = redactValue(k, v)
  }
  return out
}

/** Clip for export only. Marker states this is NOT the runtime tool-output bound. */
export function clipForExport(s: string, max: number): { text: string; exportClipped: boolean } {
  if (s.length <= max) return { text: s, exportClipped: false }
  return {
    text: `${s.slice(0, max)}…[export clipped ${s.length - max} chars; not a runtime tool cap]`,
    exportClipped: true,
  }
}

function sanitizeConfig(config: SessionConfig | Record<string, unknown> | undefined): Record<string, unknown> {
  if (!config || typeof config !== 'object') return {}
  const raw = { ...(config as Record<string, unknown>) }
  // Never include provider secrets if they leaked onto session config.
  delete raw.apiKey
  delete raw.token
  return redactObject(raw)
}

function sanitizeToolCalls(toolCalls: unknown[] | undefined): unknown[] | undefined {
  if (!toolCalls?.length) return undefined
  return toolCalls.map((tc) => {
    if (!tc || typeof tc !== 'object') return tc
    const o = { ...(tc as Record<string, unknown>) }
    // Preserve runtime `truncated` (from TOOL_BLOB_CAP / event path) if present.
    let exportClipped = false
    for (const key of ['input', 'output', 'error'] as const) {
      const v = o[key]
      if (typeof v === 'string') {
        const clipped = clipForExport(v, MAX_TOOL_FIELD)
        o[key] = clipped.text
        if (clipped.exportClipped) exportClipped = true
      }
    }
    if (exportClipped) o.exportClipped = true
    return o
  })
}

function sanitizeTimeline(steps: TimelineStep[] | undefined): unknown[] | undefined {
  if (!steps?.length) return undefined
  return steps.map((s) => {
    if (s.kind === 'reasoning') {
      const clipped = clipForExport(s.content ?? '', MAX_CONTENT)
      return {
        kind: 'reasoning',
        stepSeq: s.stepSeq,
        agentId: s.agentId,
        role: s.role,
        content: clipped.text,
        ...(clipped.exportClipped ? { exportClipped: true } : {}),
      }
    }
    return {
      kind: 'tool',
      stepSeq: s.stepSeq,
      agentId: s.agentId,
      role: s.role,
      callId: s.callId,
    }
  })
}

function isToolErrorOutput(output: unknown, status: unknown, error: unknown): boolean {
  if (status === 'error') return true
  if (typeof error === 'string' && error.length > 0) return true
  if (typeof output === 'string' && (output.startsWith('Error') || output.startsWith('error:'))) return true
  return false
}

function toolPreview(output: unknown, error: unknown): string {
  const raw = typeof error === 'string' && error.length > 0
    ? error
    : typeof output === 'string'
      ? output
      : ''
  return raw.length <= ERROR_PREVIEW ? raw : `${raw.slice(0, ERROR_PREVIEW)}…`
}

/** Derive offline-friendly stats from messages (pure; safe for tests). */
export function buildDebugAnalysis(messages: Message[]): SessionDebugAnalysis {
  let userTurns = 0
  let assistantTurns = 0
  let stoppedTurns = 0
  let toolCallCount = 0
  let toolErrorCount = 0
  const toolsByName: Record<string, number> = {}
  const planToolCounts = { EnterPlanMode: 0, ExitPlanMode: 0, write_todos: 0 }
  const toolErrors: SessionDebugAnalysis['toolErrors'] = []
  const messageGapsMs: number[] = []

  let prevTs: number | undefined
  for (const m of messages) {
    if (typeof m.timestamp === 'number' && typeof prevTs === 'number') {
      messageGapsMs.push(m.timestamp - prevTs)
    }
    if (typeof m.timestamp === 'number') prevTs = m.timestamp

    if (m.role === 'user') userTurns += 1
    if (m.role === 'assistant') {
      assistantTurns += 1
      if (m.stopped) stoppedTurns += 1
    }

    for (const tc of m.toolCalls ?? []) {
      toolCallCount += 1
      const name = typeof tc.name === 'string' ? tc.name : 'unknown'
      toolsByName[name] = (toolsByName[name] ?? 0) + 1
      if (name === 'EnterPlanMode' || name === 'ExitPlanMode' || name === 'write_todos') {
        planToolCounts[name] += 1
      }
      if (isToolErrorOutput(tc.output, tc.status, tc.error)) {
        toolErrorCount += 1
        if (toolErrors.length < MAX_ERROR_ROWS) {
          toolErrors.push({
            messageId: m.id,
            name,
            ...(typeof tc.callId === 'string' ? { callId: tc.callId } : {}),
            ...(typeof tc.status === 'string' ? { status: tc.status } : {}),
            preview: toolPreview(tc.output, tc.error),
          })
        }
      }
    }
  }

  return {
    messageCount: messages.length,
    userTurns,
    assistantTurns,
    stoppedTurns,
    toolCallCount,
    toolErrorCount,
    toolsByName,
    planToolCounts,
    toolErrors,
    messageGapsMs,
  }
}

function messageMeta(m: Message): SessionDebugBundle['messages'][number]['meta'] {
  const toolCalls = m.toolCalls ?? []
  if (toolCalls.length === 0 && !m.agentRuns?.length) return undefined
  const toolNames: string[] = []
  let toolErrorCount = 0
  let hasExitPlanMode = false
  let hasEnterPlanMode = false
  for (const tc of toolCalls) {
    const name = typeof tc.name === 'string' ? tc.name : 'unknown'
    toolNames.push(name)
    if (name === 'ExitPlanMode') hasExitPlanMode = true
    if (name === 'EnterPlanMode') hasEnterPlanMode = true
    if (isToolErrorOutput(tc.output, tc.status, tc.error)) toolErrorCount += 1
  }
  let durationMs: number | undefined
  if (m.agentRuns?.length) {
    const starts = m.agentRuns.map((r) => r.startedAt).filter((n): n is number => typeof n === 'number')
    const ends = m.agentRuns.map((r) => r.finishedAt).filter((n): n is number => typeof n === 'number')
    if (starts.length && ends.length) {
      durationMs = Math.max(...ends) - Math.min(...starts)
    }
  }
  return {
    toolCount: toolCalls.length,
    toolErrorCount,
    toolNames,
    ...(hasExitPlanMode ? { hasExitPlanMode: true } : {}),
    ...(hasEnterPlanMode ? { hasEnterPlanMode: true } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
  }
}

export type BuildDebugBundleInput = {
  sessionId: string
  title: string
  config?: SessionConfig | Record<string, unknown>
  messages: Message[]
  recentErrors?: Array<{ code?: string; message: string; at?: number }>
  appVersion?: string
  now?: () => string
  /** Optional live session UI flags (plan approval, interrupt, status). */
  ui?: SessionDebugUiState
}

/** Pure builder for the redacted session debug export payload. */
export function buildSessionDebugBundle(input: BuildDebugBundleInput): SessionDebugBundle {
  const cfg = sanitizeConfig(input.config)
  const surface = typeof cfg.surface === 'string' ? cfg.surface : undefined
  const cwd = typeof cfg.cwd === 'string' ? cfg.cwd : undefined
  const forcePlan = Boolean(cfg.forcePlan)
  const analysis = buildDebugAnalysis(input.messages)

  const ui: SessionDebugUiState | undefined = input.ui
    ? {
        ...(input.ui.status !== undefined ? { status: input.ui.status } : {}),
        ...(input.ui.planApprovalPending !== undefined
          ? { planApprovalPending: input.ui.planApprovalPending }
          : {}),
        ...(input.ui.interrupt !== undefined ? { interrupt: input.ui.interrupt } : {}),
        ...(input.ui.activeTurnPlan !== undefined ? { activeTurnPlan: input.ui.activeTurnPlan } : {}),
        forcePlan: input.ui.forcePlan ?? forcePlan,
      }
    : forcePlan
      ? { forcePlan }
      : undefined

  return {
    version: 3,
    exportedAt: (input.now ?? (() => new Date().toISOString()))(),
    ...(input.appVersion ? { appVersion: input.appVersion } : {}),
    session: {
      id: input.sessionId,
      title: input.title,
      ...(surface ? { surface } : {}),
      ...(cwd ? { cwd } : {}),
      config: cfg,
      runtime: {
        subagentMaxConcurrency: DEFAULT_SUBAGENT_MAX_CONCURRENCY,
        toolParallelismDefault: DEFAULT_TOOL_PARALLELISM,
      },
      ...(ui ? { ui } : {}),
    },
    messages: input.messages.map((m) => {
      const meta = messageMeta(m)
      return {
        id: m.id,
        role: m.role,
        content: clipForExport(m.content ?? '', MAX_CONTENT).text,
        ...(m.agentId ? { agentId: m.agentId } : {}),
        ...(m.stopped ? { stopped: true } : {}),
        ...(typeof m.timestamp === 'number' ? { timestamp: m.timestamp } : {}),
        ...(m.toolCalls?.length ? { toolCalls: sanitizeToolCalls(m.toolCalls) } : {}),
        ...(m.agentRuns?.length
          ? {
              agentRuns: m.agentRuns.map((r) => ({
                agentId: r.agentId,
                role: r.role,
                output: clipForExport(r.output ?? '', MAX_CONTENT).text,
                startedAt: r.startedAt,
                finishedAt: r.finishedAt,
                seq: r.seq,
                ...(r.taskInput ? { taskInput: clipForExport(r.taskInput, MAX_CONTENT).text } : {}),
                ...(r.parentAgentId ? { parentAgentId: r.parentAgentId } : {}),
                ...(r.messageId ? { messageId: r.messageId } : {}),
                ...(r.usage ? { usage: r.usage } : {}),
              })),
            }
          : {}),
        ...(m.timeline?.length ? { timeline: sanitizeTimeline(m.timeline) } : {}),
        ...(meta ? { meta } : {}),
      }
    }),
    analysis,
    ...(input.recentErrors?.length ? { recentErrors: input.recentErrors } : {}),
  }
}

export function sessionDebugBundleJson(input: BuildDebugBundleInput): string {
  return `${JSON.stringify(buildSessionDebugBundle(input), null, 2)}\n`
}
