import type { AgentRun, ToolCall, TimelineStep } from '@hip/protocol'
import { toolCategory, toolTitleHint, TASK_HINT_MAX } from './toolPresentation'
import { latestTodos, planProgress } from './todos'

export type ActivityUiStatus = 'running' | 'success' | 'success_partial' | 'error' | 'stopped'

export type SummaryPart =
  | { type: 'completed' }
  | { type: 'stopped' }
  | { type: 'toolCount'; finished: number; total: number }
  | { type: 'agentCount'; agents: number }
  | { type: 'partialTools'; count: number }
  | { type: 'categorySummary'; search: number; read: number; browse: number }
  | { type: 'taskHint'; text: string }
  | { type: 'runningTool'; label: string }
  | { type: 'runningReasoning' }
  | { type: 'initializing' }
  | { type: 'planProgress'; done: number; total: number }

export interface ActivitySummaryInput {
  streaming?: boolean
  stopped?: boolean
  hasAssistantContent?: boolean
  steps?: TimelineStep[]
  toolCalls?: ToolCall[]
  agentRuns?: AgentRun[]
}

export function countToolsByCategory(tools: ToolCall[]): {
  search: number
  read: number
  browse: number
  edit: number
  shell: number
  delegate: number
  other: number
  plan: number
} {
  const c = { search: 0, read: 0, browse: 0, edit: 0, shell: 0, delegate: 0, other: 0, plan: 0 }
  for (const t of tools) {
    c[toolCategory(t.name)]++
  }
  return c
}

/** Non-supervisor agent runs count as sub-agents for the chip. */
export function countSubAgents(agentRuns: AgentRun[]): number {
  const ids = new Set(agentRuns.filter((r) => r.role !== 'supervisor').map((r) => r.agentId))
  return ids.size
}

export function extractTaskHint(toolCalls: ToolCall[], agentRuns: AgentRun[]): string | null {
  for (const t of toolCalls) {
    if (t.name === 'task' || t.name === 'dispatch_agent') {
      const hint = toolTitleHint(t)
      if (hint && hint !== t.name) return hint.length > TASK_HINT_MAX ? `${hint.slice(0, TASK_HINT_MAX - 1)}…` : hint
    }
  }
  for (const r of agentRuns) {
    if (r.role !== 'supervisor' && r.taskInput?.trim()) {
      const t = r.taskInput.trim().replace(/\s+/g, ' ')
      return t.length > TASK_HINT_MAX ? `${t.slice(0, TASK_HINT_MAX - 1)}…` : t
    }
  }
  return null
}

export function resolveActivityStatus(input: ActivitySummaryInput): ActivityUiStatus {
  const tools = input.toolCalls ?? []
  if (input.streaming) return 'running'
  if (input.stopped) return 'stopped'
  const errorCount = tools.filter((t) => t.status === 'error').length
  const hasContent = !!input.hasAssistantContent
  if (!hasContent && errorCount > 0) return 'error'
  if (errorCount > 0) return 'success_partial'
  return 'success'
}

function planProgressPart(tools: ToolCall[]): SummaryPart | null {
  const live = latestTodos(tools)
  if (!live || live.todos.length === 0) return null
  const p = planProgress(live.todos)
  return { type: 'planProgress', done: p.done, total: p.total }
}

function withPlanProgress(parts: SummaryPart[], tools: ToolCall[]): SummaryPart[] {
  const plan = planProgressPart(tools)
  return plan ? [plan, ...parts] : parts
}

/**
 * Build structured summary parts for the ActivityBar.
 * Guarantees completed turns with tools are not "toolCount-only" when category or task data exists.
 */
export function buildActivitySummary(input: ActivitySummaryInput): {
  status: ActivityUiStatus
  parts: SummaryPart[]
} {
  const tools = input.toolCalls ?? []
  const runs = input.agentRuns ?? []
  const steps = input.steps ?? []
  const status = resolveActivityStatus(input)

  if (input.streaming) {
    const ordered = [...steps].sort((a, b) => a.stepSeq - b.stepSeq)
    const last = ordered[ordered.length - 1]
    if (last?.kind === 'tool') {
      const tool = tools.find((t) => t.callId === last.callId)
      if (tool) {
        return {
          status: 'running',
          parts: withPlanProgress([{ type: 'runningTool', label: toolTitleHint(tool) }], tools),
        }
      }
    }
    if (last?.kind === 'reasoning') {
      return { status: 'running', parts: withPlanProgress([{ type: 'runningReasoning' }], tools) }
    }
    // kind:'text' while streaming: assistant is writing the answer body — not "thinking".
    // Prefer tool chrome when tools exist; otherwise plan-only or bare running (no runningReasoning).
    if (last?.kind === 'text') {
      const running = [...tools].reverse().find((t) => t.status === 'running')
      if (running) {
        return {
          status: 'running',
          parts: withPlanProgress([{ type: 'runningTool', label: toolTitleHint(running) }], tools),
        }
      }
      if (tools.length > 0) {
        const lastTool = tools.reduce((a, b) => (a.seq >= b.seq ? a : b))
        return {
          status: 'running',
          parts: withPlanProgress([{ type: 'runningTool', label: toolTitleHint(lastTool) }], tools),
        }
      }
      const planOnly = withPlanProgress([], tools)
      if (planOnly.length > 0) return { status: 'running', parts: planOnly }
      // Neutral running while content streams (avoid misleading thinking chip).
      return { status: 'running', parts: input.hasAssistantContent ? [] : [{ type: 'initializing' }] }
    }
    // Fallback: last running tool or any tool
    const running = [...tools].reverse().find((t) => t.status === 'running')
    if (running) {
      return {
        status: 'running',
        parts: withPlanProgress([{ type: 'runningTool', label: toolTitleHint(running) }], tools),
      }
    }
    if (tools.length > 0) {
      const lastTool = tools.reduce((a, b) => (a.seq >= b.seq ? a : b))
      return {
        status: 'running',
        parts: withPlanProgress([{ type: 'runningTool', label: toolTitleHint(lastTool) }], tools),
      }
    }
    if (steps.length === 0 && tools.length === 0 && runs.length === 0) {
      return { status: 'running', parts: [{ type: 'initializing' }] }
    }
    return { status: 'running', parts: withPlanProgress([{ type: 'runningReasoning' }], tools) }
  }

  const parts: SummaryPart[] = []
  if (status === 'stopped') parts.push({ type: 'stopped' })
  else parts.push({ type: 'completed' })

  const plan = planProgressPart(tools)
  if (plan) parts.push(plan)

  const taskHint = extractTaskHint(tools, runs)
  if (taskHint) parts.push({ type: 'taskHint', text: taskHint })

  const cats = countToolsByCategory(tools)
  const hasCat = cats.search > 0 || cats.read > 0 || cats.browse > 0
  if (hasCat) {
    parts.push({
      type: 'categorySummary',
      search: cats.search,
      read: cats.read,
      browse: cats.browse,
    })
  }

  if (tools.length > 0) {
    const finished = tools.filter((t) => t.status === 'finished').length
    parts.push({ type: 'toolCount', finished, total: tools.length })
  }

  const agents = countSubAgents(runs)
  if (agents > 0) parts.push({ type: 'agentCount', agents })

  const errorCount = tools.filter((t) => t.status === 'error').length
  if (errorCount > 0) parts.push({ type: 'partialTools', count: errorCount })

  // Spec: must not be toolCount-only when we could add signal — if only toolCount after completed, OK for single-tool; if no cat/task, toolCount alone is acceptable for tiny turns.
  return { status, parts }
}

/** Wall-clock ms from agentRuns when available. */
export function activityElapsedMs(agentRuns: AgentRun[] | undefined): number | null {
  if (!agentRuns?.length) return null
  let min = Infinity
  let max = -Infinity
  for (const r of agentRuns) {
    if (typeof r.startedAt === 'number') min = Math.min(min, r.startedAt)
    const end = r.finishedAt ?? r.startedAt
    if (typeof end === 'number') max = Math.max(max, end)
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return null
  return max - min
}

export function formatElapsed(ms: number): string {
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}
