/**
 * Per-conversation permission mode (Claude-Desktop style).
 * Keep in sync with PermissionMode in index.ts.
 */
export type PermissionMode = 'chat' | 'edit' | 'full'

/**
 * Keep in sync with OrchestrationMode in orchestration-types.ts.
 * @deprecated Ignored for turn routing; retained for config JSON compatibility.
 */
export type OrchModeDefault = 'fast' | 'dag'

/**
 * Minimal SessionConfig shape used by normalizeSessionConfig.
 * Mirrors SessionConfig in index.ts — keep fields in sync.
 */
export interface SessionConfigLike {
  llmProvider: string
  model: string
  baseURL?: string
  tools: string[]
  systemPrompt?: string
  cwd?: string
  thinking?: boolean
  language?: 'en' | 'zh-CN' | 'zh-TW'
  agentId?: string
  permissionMode?: PermissionMode
  enableStickyApproval?: boolean
  forcePlan?: boolean
  disablePlan?: boolean
  surface?: 'chat' | 'code'
  useEventSource?: boolean
  /** @deprecated Ignored for turn routing; retained for config JSON compatibility. */
  orchMode?: OrchModeDefault
  /** undefined ⇒ inherit global memory.json useMemories */
  useMemories?: boolean
  /** undefined ⇒ inherit global memory.json generateMemories */
  generateMemories?: boolean
  /** When true, skip memory inject/extract for this session. */
  incognito?: boolean
}

/** Effective defaults applied when optional SessionConfig fields are undefined. */
export const SESSION_CONFIG_DEFAULTS = {
  permissionMode: 'edit' as PermissionMode,
  enableStickyApproval: true,
  useEventSource: true,
  orchMode: 'fast' as OrchModeDefault,
} as const

/** SessionConfig with optional fields filled to effective defaults. */
export type NormalizedSessionConfig<T extends SessionConfigLike = SessionConfigLike> = T & {
  permissionMode: PermissionMode
  enableStickyApproval: boolean
  useEventSource: boolean
  orchMode: OrchModeDefault
}

/**
 * Fill optional SessionConfig fields with the single source of truth defaults.
 * Explicit values (including `false`) are preserved.
 * Does not invent llmProvider / model / tools — callers must supply those.
 */
export function normalizeSessionConfig<T extends SessionConfigLike>(config: T): NormalizedSessionConfig<T> {
  return {
    ...config,
    permissionMode: config.permissionMode ?? SESSION_CONFIG_DEFAULTS.permissionMode,
    enableStickyApproval: config.enableStickyApproval ?? SESSION_CONFIG_DEFAULTS.enableStickyApproval,
    useEventSource: config.useEventSource ?? SESSION_CONFIG_DEFAULTS.useEventSource,
    orchMode: config.orchMode ?? SESSION_CONFIG_DEFAULTS.orchMode,
  }
}
