import type { ResolvedModel } from './registry.js'

/** The standard env contract a custom external agent reads. A per-agent adapter (Plan B) may remap these. */
export function buildModelEnv(m: ResolvedModel): Record<string, string> {
  return {
    HIP_MODEL: m.modelID,
    HIP_BASE_URL: m.baseURL,
    ...(m.apiKey ? { HIP_API_KEY: m.apiKey } : {}),
  }
}

export type RichEvent =
  | { kind: 'text'; delta: string }
  | { kind: 'reasoning'; delta: string }
  | { kind: 'tool_start'; id: string; name: string; input: unknown }
  | { kind: 'tool_end'; id: string; output?: string; ok: boolean }
  | { kind: 'done' }

/** Parse one newline-delimited rich-protocol line. Returns null for noise (logged & skipped upstream). */
export function parseRichLine(line: string): RichEvent | null {
  let o: Record<string, unknown>
  try { o = JSON.parse(line) as Record<string, unknown> } catch { return null }
  switch (o?.type) {
    case 'text': return typeof o.delta === 'string' ? { kind: 'text', delta: o.delta } : null
    case 'reasoning': return typeof o.delta === 'string' ? { kind: 'reasoning', delta: o.delta } : null
    case 'tool_start':
      return o.id != null && o.name != null
        ? { kind: 'tool_start', id: String(o.id), name: String(o.name), input: o.input }
        : null
    case 'tool_end':
      return o.id != null
        ? { kind: 'tool_end', id: String(o.id), output: o.output != null ? String(o.output) : undefined, ok: o.ok !== false }
        : null
    case 'done': return { kind: 'done' }
    default: return null
  }
}
