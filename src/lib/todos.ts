import type { Message, PlanItem, ToolCall } from '@hip/protocol'

export type TodoStatus = 'pending' | 'in_progress' | 'completed'
export interface Todo {
  content: string
  status: TodoStatus
}

const STATUSES: ReadonlySet<string> = new Set(['pending', 'in_progress', 'completed'])

/** Parse a write_todos ToolCall.input (JSON) into typed todos; drops malformed entries, never throws. */
export function parseTodos(input: string): Todo[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(input)
  } catch {
    return []
  }
  const raw = (parsed as { todos?: unknown }).todos
  if (!Array.isArray(raw)) return []
  const out: Todo[] = []
  for (const item of raw) {
    if (item && typeof item === 'object') {
      const { content, status } = item as { content?: unknown; status?: unknown }
      if (typeof content === 'string' && typeof status === 'string' && STATUSES.has(status)) {
        out.push({ content, status: status as TodoStatus })
      }
    }
  }
  return out
}

export interface LivePlan {
  callId: string
  todos: Todo[]
}

/** The latest (highest-seq) write_todos call by the SUPERVISOR in a turn's tool calls — the live
 *  plan. Scoped to the supervisor so a sub-agent's own write_todos can't mask the main plan (a
 *  turn's Message.toolCalls flattens child runs' calls too). Null if none. */
export function latestTodos(toolCalls?: ToolCall[]): LivePlan | null {
  if (!toolCalls || toolCalls.length === 0) return null
  let latest: ToolCall | null = null
  for (const tc of toolCalls) {
    if (tc.name === 'write_todos' && tc.agentId === 'supervisor' && (latest === null || tc.seq > latest.seq)) latest = tc
  }
  if (!latest) return null
  return { callId: latest.callId, todos: parseTodos(latest.input) }
}

export type PlanPhase = 'planning' | 'awaiting_approval' | 'executing' | 'done'
export type LivePlanSource = 'activeTurnPlan' | 'write_todos' | 'empty'
/**
 * Pure UI phase for chip/panel gating (D4a). Includes `off` when nothing to show.
 * `'pending'` is reserved for design parity and is unused in v1 — forcePlan+idle maps to `off`
 * (chip alone; no sticky empty bar).
 */
export type PlanUiPhase = 'off' | 'pending' | 'planning' | 'awaiting_approval' | 'executing' | 'done'

export interface LivePlanView {
  items: PlanItem[]
  phase: PlanPhase
  source: LivePlanSource
  progress: { done: number; total: number; current?: string }
}

export function planProgress(items: PlanItem[]): LivePlanView['progress'] {
  const total = items.length
  let done = 0
  let current: string | undefined
  for (const item of items) {
    if (item.status === 'completed') done += 1
    else if (item.status === 'in_progress' && current === undefined) current = item.content
  }
  return current !== undefined ? { done, total, current } : { done, total }
}

function todosToPlanItems(todos: Todo[]): PlanItem[] {
  return todos.map((t) => ({ content: t.content, status: t.status }))
}

function makeView(items: PlanItem[], phase: PlanPhase, source: LivePlanSource): LivePlanView {
  return { items, phase, source, progress: planProgress(items) }
}

export interface SelectLivePlanInput {
  messages: Message[]
  status: 'idle' | 'running' | 'error'
  forcePlan?: boolean
  planApprovalPending?: boolean
  activeTurnPlan?: PlanItem[] | null
}

export interface DerivePlanUiPhaseInput {
  forcePlan: boolean
  planApprovalPending: boolean
  status: 'idle' | 'running' | 'error'
  activeTurnPlan: PlanItem[] | null | undefined
  interruptContextKind?: 'plan_approval' | string
  lastMessageRole?: 'user' | 'assistant' | 'notice'
}

/**
 * Pure plan UI phase (D4a gold table). Independent of message list / write_todos.
 * Not yet wired into chip/panel production paths — `selectLivePlan` remains authoritative
 * for sticky panel items/source/phase until a follow-up binds this helper for phase-only gates.
 * `selectLivePlan` may still surface write_todos when activeTurnPlan is empty.
 */
export function derivePlanUiPhase(input: DerivePlanUiPhaseInput): PlanUiPhase {
  const { forcePlan, planApprovalPending, status, activeTurnPlan } = input
  if (planApprovalPending) return 'awaiting_approval'

  const hasItems = Array.isArray(activeTurnPlan) && activeTurnPlan.length > 0

  if (forcePlan && status === 'running') return 'planning'
  // forcePlan + idle + no sticky items → off (chip alone; no empty planning bar)
  if (forcePlan && !hasItems) return 'off'

  if (hasItems) {
    if (status === 'running') return 'executing'
    return 'done'
  }

  return 'off'
}

/**
 * Session-level live plan for the sticky PlanProgressPanel.
 * Returns null when the panel should be hidden.
 * Priority and turn-context rules: docs/design/2026-07-17-plan-todo-panel-spec.md §3.
 */
export function selectLivePlan(input: SelectLivePlanInput): LivePlanView | null {
  const { messages, status, forcePlan, planApprovalPending, activeTurnPlan } = input
  const planItems = activeTurnPlan?.length ? activeTurnPlan : null

  // Pending approval always shows the panel — even with an empty plan (RC-7 / D4b).
  if (planApprovalPending) {
    const items = activeTurnPlan ?? []
    const source: LivePlanSource = items.length > 0 ? 'activeTurnPlan' : 'empty'
    return makeView(items, 'awaiting_approval', source)
  }

  const last = messages.length > 0 ? messages[messages.length - 1] : undefined
  const lastAssistant = findLastAssistant(messages)

  // New turn started: do not stick previous assistant todos.
  if (last?.role === 'user' && status === 'running') {
    if (planItems) {
      // forcePlan still on → drafting/resume-plan; cleared after approve → execute.
      const phase: PlanPhase = forcePlan ? 'planning' : 'executing'
      return makeView(planItems, phase, 'activeTurnPlan')
    }
    if (forcePlan) {
      return makeView([], 'planning', 'empty')
    }
    return null
  }

  // Idle after user message with no pending plan — hide.
  if (last?.role === 'user' && status !== 'running') {
    if (planItems) {
      return makeView(planItems, 'done', 'activeTurnPlan')
    }
    return null
  }

  const toolPlan = lastAssistant ? latestTodos(lastAssistant.toolCalls) : null
  const toolItems = toolPlan && toolPlan.todos.length > 0 ? todosToPlanItems(toolPlan.todos) : null

  if (toolItems) {
    // forcePlan + running + no approval yet → still drafting (not execute phase).
    const phase: PlanPhase =
      status !== 'running' ? 'done' : forcePlan ? 'planning' : 'executing'
    return makeView(toolItems, phase, 'write_todos')
  }

  if (planItems) {
    const phase: PlanPhase =
      status !== 'running' ? 'done' : forcePlan ? 'planning' : 'executing'
    return makeView(planItems, phase, 'activeTurnPlan')
  }

  if (forcePlan && status === 'running') {
    return makeView([], 'planning', 'empty')
  }

  return null
}

function findLastAssistant(messages: Message[]): Message | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') return messages[i]
  }
  return undefined
}
