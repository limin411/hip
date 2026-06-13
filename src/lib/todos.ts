import type { ToolCall } from '@hip/protocol'

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

/** The latest (highest-seq) write_todos call in a turn's tool calls — the live plan. Null if none. */
export function latestTodos(toolCalls?: ToolCall[]): LivePlan | null {
  if (!toolCalls || toolCalls.length === 0) return null
  let latest: ToolCall | null = null
  for (const tc of toolCalls) {
    if (tc.name === 'write_todos' && (latest === null || tc.seq > latest.seq)) latest = tc
  }
  if (!latest) return null
  return { callId: latest.callId, todos: parseTodos(latest.input) }
}
