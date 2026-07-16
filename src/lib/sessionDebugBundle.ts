import type { Message, SessionConfig } from '@hip/protocol'

export type SessionDebugBundle = {
  version: 1
  exportedAt: string
  appVersion?: string
  session: {
    id: string
    title: string
    surface?: string
    cwd?: string
    config: Record<string, unknown>
  }
  messages: Array<{
    id: string
    role: string
    content: string
    agentId?: string
    stopped?: boolean
    toolCalls?: unknown[]
    agentRuns?: unknown[]
  }>
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

export type BuildDebugBundleInput = {
  sessionId: string
  title: string
  config?: SessionConfig | Record<string, unknown>
  messages: Message[]
  recentErrors?: Array<{ code?: string; message: string; at?: number }>
  appVersion?: string
  now?: () => string
}

/** Pure builder for the redacted session debug export payload. */
export function buildSessionDebugBundle(input: BuildDebugBundleInput): SessionDebugBundle {
  const cfg = sanitizeConfig(input.config)
  const surface = typeof cfg.surface === 'string' ? cfg.surface : undefined
  const cwd = typeof cfg.cwd === 'string' ? cfg.cwd : undefined
  return {
    version: 1,
    exportedAt: (input.now ?? (() => new Date().toISOString()))(),
    ...(input.appVersion ? { appVersion: input.appVersion } : {}),
    session: {
      id: input.sessionId,
      title: input.title,
      ...(surface ? { surface } : {}),
      ...(cwd ? { cwd } : {}),
      config: cfg,
    },
    messages: input.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: clipForExport(m.content ?? '', MAX_CONTENT).text,
      ...(m.agentId ? { agentId: m.agentId } : {}),
      ...(m.stopped ? { stopped: true } : {}),
      ...(m.toolCalls?.length ? { toolCalls: sanitizeToolCalls(m.toolCalls) } : {}),
      ...(m.agentRuns?.length
        ? {
            agentRuns: m.agentRuns.map((r) => ({
              agentId: r.agentId,
              role: r.role,
              output: clipForExport(r.output ?? '', MAX_CONTENT).text,
              startedAt: r.startedAt,
              finishedAt: r.finishedAt,
              ...(r.usage ? { usage: r.usage } : {}),
            })),
          }
        : {}),
    })),
    ...(input.recentErrors?.length ? { recentErrors: input.recentErrors } : {}),
  }
}

export function sessionDebugBundleJson(input: BuildDebugBundleInput): string {
  return `${JSON.stringify(buildSessionDebugBundle(input), null, 2)}\n`
}
