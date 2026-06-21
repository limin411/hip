import type { JsonValue, Source, Unavailable } from '../system-context.js'

// ── Payload ───────────────────────────────────────────────────────────────────

export interface SubagentSourcePayload {
  readonly text: string
  readonly subagentIds: string[]
}

// ── Input ─────────────────────────────────────────────────────────────────────

export interface SubagentSourceInput {
  readonly pendingSubagents?: Array<{
    readonly id: string
    readonly description: string
    readonly status: 'running' | 'completed' | 'failed'
  }>
  readonly completedSubagents?: Array<{
    readonly id: string
    readonly description: string
    readonly status: 'running' | 'completed' | 'failed'
  }>
}

// ── Codec ─────────────────────────────────────────────────────────────────────

function isObject(j: JsonValue): j is { readonly [key: string]: JsonValue } {
  return typeof j === 'object' && j !== null && !Array.isArray(j)
}

function stringField(j: { readonly [key: string]: JsonValue }, key: string): string {
  const value = j[key]
  return typeof value === 'string' ? value : ''
}

function stringArray(j: JsonValue): string[] {
  if (!Array.isArray(j)) return []
  return j.filter((item): item is string => typeof item === 'string')
}

function renderSubagentText(input: SubagentSourceInput): string {
  const sections: string[] = []

  if (input.pendingSubagents && input.pendingSubagents.length > 0) {
    const pending = input.pendingSubagents
      .map((s) => `- ${s.description} (${s.id})`)
      .join('\n')
    sections.push(`Pending background tasks:\n${pending}`)
  }

  if (input.completedSubagents && input.completedSubagents.length > 0) {
    const completed = input.completedSubagents
      .map((s) => `- ${s.description} (${s.id}) — ${s.status}`)
      .join('\n')
    sections.push(`Completed background tasks:\n${completed}`)
  }

  return sections.join('\n\n')
}

const codec = {
  encode(a: SubagentSourcePayload): JsonValue {
    return {
      text: a.text,
      subagentIds: a.subagentIds,
    }
  },
  decode(j: JsonValue): SubagentSourcePayload {
    if (!isObject(j)) {
      return { text: '', subagentIds: [] }
    }
    return {
      text: stringField(j, 'text'),
      subagentIds: stringArray(j.subagentIds),
    }
  },
}

// ── Source ────────────────────────────────────────────────────────────────────

export function createSubagentSource(
  input: SubagentSourceInput,
): Source<SubagentSourcePayload> {
  return {
    key: 'fragment:subagents',
    codec,
    load: async () => {
      const hasPending = input.pendingSubagents !== undefined && input.pendingSubagents.length > 0
      const hasCompleted = input.completedSubagents !== undefined && input.completedSubagents.length > 0
      if (!hasPending && !hasCompleted) {
        return { _tag: 'Unavailable', reason: 'no background tasks are active' } as Unavailable
      }
      const subagentIds = [
        ...(input.pendingSubagents ?? []).map((s) => s.id),
        ...(input.completedSubagents ?? []).map((s) => s.id),
      ]
      return { text: renderSubagentText(input), subagentIds }
    },
    baseline: (payload) => payload.text,
  }
}
