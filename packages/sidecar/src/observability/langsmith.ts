/**
 * LangSmith tracing bootstrap + invoke helpers.
 *
 * Primary config: `[langsmith]` in hip.toml (global `HIP_CONFIG_PATH`, or
 * project `.hip/hip.toml` when resolved via resolveEffectiveConfig).
 *
 * ```toml
 * [langsmith]
 * enabled = true
 * api_key = "lsv2_…"
 * project = "hip"
 * endpoint = "https://eu.api.smith.langchain.com"
 * ```
 *
 * Process env (`LANGSMITH_*` / legacy `LANGCHAIN_*`) still wins when already
 * set — useful for one-off overrides without editing hip.toml.
 *
 * When disabled (default), this module is a no-op for tracing decisions.
 */

import type { LangSmithConfig } from '@hip/protocol'
import { readHipConfig } from '../config/hip-config.js'
import { logInfo, logDebug } from '../debug-logger.js'

function envFirst(...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = process.env[k]?.trim()
    if (v) return v
  }
  return undefined
}

/** Set env only when unset/empty so explicit process env keeps precedence. */
function setEnvIfUnset(key: string, value: string): void {
  if (!process.env[key]?.trim()) {
    process.env[key] = value
  }
}

/**
 * Apply a LangSmithConfig onto process.env for the LangChain/LangSmith SDK.
 * Does not overwrite env vars that are already set.
 */
export function applyLangSmithConfig(cfg?: LangSmithConfig | null): void {
  if (!cfg) return

  if (cfg.enabled === true) {
    setEnvIfUnset('LANGSMITH_TRACING', 'true')
    setEnvIfUnset('LANGCHAIN_TRACING_V2', 'true')
    // Block until root runs are finalized so a follow-up (e.g. title LLM with
    // tracing forced off) cannot race the first turn's async batch upload.
    setEnvIfUnset('LANGCHAIN_CALLBACKS_BACKGROUND', 'false')
  } else if (cfg.enabled === false) {
    // Force-off only when nothing already requested tracing via env.
    if (
      !envFirst(
        'LANGSMITH_TRACING',
        'LANGSMITH_TRACING_V2',
        'LANGCHAIN_TRACING_V2',
        'LANGCHAIN_TRACING',
      )
    ) {
      process.env.LANGSMITH_TRACING = 'false'
    }
  }

  if (cfg.apiKey) {
    setEnvIfUnset('LANGSMITH_API_KEY', cfg.apiKey)
    setEnvIfUnset('LANGCHAIN_API_KEY', cfg.apiKey)
  }
  if (cfg.project) {
    setEnvIfUnset('LANGSMITH_PROJECT', cfg.project)
    setEnvIfUnset('LANGCHAIN_PROJECT', cfg.project)
  }
  if (cfg.endpoint) {
    setEnvIfUnset('LANGSMITH_ENDPOINT', cfg.endpoint)
    setEnvIfUnset('LANGCHAIN_ENDPOINT', cfg.endpoint)
  }
}

/** Load `[langsmith]` from global hip.toml (`HIP_CONFIG_PATH`) and apply to env. */
export function loadLangSmithFromHipConfig(configPath?: string): LangSmithConfig | undefined {
  const cfg = readHipConfig(configPath).langsmith
  applyLangSmithConfig(cfg)
  return cfg
}

/** True when LangSmith auto-tracing is requested (after config/env resolve). */
export function isLangSmithTracingEnabled(): boolean {
  const v =
    process.env.LANGSMITH_TRACING ??
    process.env.LANGSMITH_TRACING_V2 ??
    process.env.LANGCHAIN_TRACING_V2 ??
    process.env.LANGCHAIN_TRACING
  return v === 'true'
}

export interface LangSmithStatus {
  enabled: boolean
  project?: string
  endpoint?: string
  hasApiKey: boolean
  /** True when values came at least partly from hip.toml (section present). */
  fromConfig?: boolean
}

/** Snapshot of the current LangSmith configuration (no secrets). */
export function langSmithStatus(opts?: { fromConfig?: boolean }): LangSmithStatus {
  const enabled = isLangSmithTracingEnabled()
  const project = envFirst('LANGSMITH_PROJECT', 'LANGCHAIN_PROJECT')
  const endpoint = envFirst('LANGSMITH_ENDPOINT', 'LANGCHAIN_ENDPOINT')
  const hasApiKey = !!envFirst('LANGSMITH_API_KEY', 'LANGCHAIN_API_KEY')
  return {
    enabled,
    ...(project ? { project } : {}),
    ...(endpoint ? { endpoint } : {}),
    hasApiKey,
    ...(opts?.fromConfig ? { fromConfig: true } : {}),
  }
}

/**
 * Load hip.toml `[langsmith]`, apply to env, and log status.
 * Call once at sidecar startup.
 */
export function initLangSmith(configPath?: string): LangSmithStatus {
  const section = loadLangSmithFromHipConfig(configPath)
  const status = langSmithStatus({ fromConfig: section !== undefined })
  if (!status.enabled) {
    logDebug('langsmith', 'tracing_disabled', {
      hasConfigSection: section !== undefined,
    })
    return status
  }
  if (!status.hasApiKey) {
    logInfo('langsmith', 'tracing_enabled_but_no_api_key', {
      project: status.project,
      endpoint: status.endpoint ?? 'default',
      fromConfig: section !== undefined,
    })
    return status
  }
  // Install Node ALS before the first user turn so turn 0 and later turns share
  // the same tracing plumbing (title gen also imports langsmith/traceable).
  void import('langsmith/traceable').catch(() => { /* optional */ })
  logInfo('langsmith', 'tracing_enabled', {
    project: status.project ?? 'default',
    endpoint: status.endpoint ?? 'default',
    fromConfig: section !== undefined,
  })
  return status
}

/**
 * Wait for auto-batched LangSmith uploads to finish.
 * Call after a session turn so the root trace is not still in-flight when
 * post-turn side work (title) forces tracing off via ALS.
 */
export async function flushLangSmithTraces(): Promise<void> {
  if (!isLangSmithTracingEnabled()) return
  try {
    const { awaitAllCallbacks } = await import('@langchain/core/callbacks/promises')
    await awaitAllCallbacks()
  } catch (err) {
    logDebug('langsmith', 'flush_failed', {
      err: err instanceof Error ? err.message : String(err),
    })
  }
}

export type TraceRunKind = 'session-turn' | 'subagent' | 'managed-agent'

/** Max length for LangSmith run names (UI list readability). */
const RUN_NAME_MAX = 200

export interface TraceContext {
  kind?: TraceRunKind
  sessionId?: string
  turnId?: string
  runId?: string
  agentId?: string
  parentAgentId?: string
  /**
   * Optional conversation title (metadata only; runName uses sessionId).
   */
  title?: string
}

/** Prefer session id as LangSmith run name; fall back to `hip.<kind>`. */
export function langSmithRunName(
  sessionId: string | undefined,
  kind: TraceRunKind = 'session-turn',
): string {
  const id = sessionId?.trim()
  if (!id) return `hip.${kind}`
  return id.length > RUN_NAME_MAX ? id.slice(0, RUN_NAME_MAX) : id
}

/**
 * Metadata keys LangSmith uses to group multi-turn traces into one **Thread**.
 * Must appear on every run (root + children) for thread filtering / token counts.
 * @see https://docs.langchain.com/langsmith/threads
 */
export function langSmithThreadMetadata(
  sessionId: string | undefined,
): Record<string, string> {
  const id = sessionId?.trim()
  if (!id) return {}
  // Both keys: UI / API accept either; set both for maximum compatibility.
  return { thread_id: id, session_id: id }
}

/**
 * Config for bare `model.invoke` / `model.stream` that should still show up
 * under a session Thread (e.g. compaction summarizer). Prefer nesting via
 * parent callbacks when inside the agent graph.
 */
export function langSmithModelCallConfig(opts: {
  runName: string
  sessionId?: string
  kind?: string
}): {
  runName?: string
  metadata?: Record<string, unknown>
  tags?: string[]
} {
  if (!isLangSmithTracingEnabled()) return {}
  const kind = opts.kind ?? opts.runName
  return {
    runName: opts.runName,
    tags: ['hip', kind],
    metadata: {
      ls_integration: 'hip',
      run_kind: kind,
      ...langSmithThreadMetadata(opts.sessionId),
    },
  }
}

/**
 * Run `fn` with LangSmith auto-tracing forced off (even when
 * LANGSMITH_TRACING=true). Use for product side-effects that must not appear
 * as their own traces (e.g. first-turn title generation).
 *
 * Implementation: LangChain's CallbackManager skips LangChainTracer when the
 * current RunTree has `tracingEnabled: false`.
 */
export async function withoutLangSmithTracing<T>(fn: () => Promise<T>): Promise<T> {
  if (!isLangSmithTracingEnabled()) return fn()
  // Dynamic import keeps cold-start free when tracing is off; package is already
  // present as a @langchain/core dependency.
  const [{ RunTree }, { withRunTree }] = await Promise.all([
    import('langsmith'),
    import('langsmith/traceable'),
  ])
  const tree = new RunTree({
    name: 'hip.no_trace',
    run_type: 'chain',
    tracingEnabled: false,
  })
  return withRunTree(tree, fn)
}

/**
 * Extra RunnableConfig fields for graph.invoke when tracing is on.
 * Empty object when disabled so callers can always spread the result.
 *
 * Each user turn is still its own root trace (LangSmith model), but all turns
 * that share the same hip session id are grouped under one Thread via
 * `thread_id` / `session_id` metadata.
 */
export function tracingInvokeFields(ctx: TraceContext = {}): {
  runName?: string
  metadata?: Record<string, unknown>
  tags?: string[]
} {
  if (!isLangSmithTracingEnabled()) return {}
  const kind = ctx.kind ?? 'session-turn'
  const metadata: Record<string, unknown> = {
    ls_integration: 'hip',
    run_kind: kind,
    ...langSmithThreadMetadata(ctx.sessionId),
  }
  if (ctx.turnId) metadata.turn_id = ctx.turnId
  if (ctx.runId) metadata.run_id = ctx.runId
  if (ctx.agentId) metadata.agent_id = ctx.agentId
  if (ctx.parentAgentId) metadata.parent_agent_id = ctx.parentAgentId
  const title = ctx.title?.trim()
  if (title) metadata.session_title = title
  return {
    // Root name = session id so related turns share a label; Thread groups them.
    runName: langSmithRunName(ctx.sessionId, kind),
    tags: ['hip', kind],
    metadata,
  }
}

/**
 * Metadata to attach to child LLM/tool runs under a graph node so LangSmith
 * shows session / agent identity without re-serializing GraphCtx.
 * Includes thread_id so child spans stay in the same Thread as the root.
 */
export function tracingChildMetadata(
  ctx: {
    sessionId?: string
    turnId?: string
    runId?: string
    agentId?: string
    parentAgentId?: string
  },
  base?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!isLangSmithTracingEnabled()) return base
  const out: Record<string, unknown> = {
    ...(base ?? {}),
    ls_integration: 'hip',
    ...langSmithThreadMetadata(ctx.sessionId),
  }
  if (ctx.turnId) out.turn_id = ctx.turnId
  if (ctx.runId) out.run_id = ctx.runId
  if (ctx.agentId) out.agent_id = ctx.agentId
  if (ctx.parentAgentId) out.parent_agent_id = ctx.parentAgentId
  return out
}
