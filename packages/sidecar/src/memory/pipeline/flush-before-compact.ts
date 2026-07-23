/**
 * Best-effort Phase1 memory extract immediately before LLM history compaction.
 *
 * Goals (aligned with grok-build memory_flush_enabled):
 * - Persist durable facts from the about-to-be-summarized span into stage1
 * - Never block compaction for long (hard timeout)
 * - Never throw into the agent loop
 */
import type { MemoryFileConfig, SessionConfig } from '@hip/protocol'
import { resolveSessionMemoryFlags } from '../config.js'
import { createDefaultMemoryLlmClient } from '../llm-client.js'
import type { MemoryService } from '../service.js'
import type { MemoryStore } from '../store.js'
import { runPhase1Extract, type Phase1ExtractResult, type SessionMessagesLoader } from './phase1-extract.js'
import { assertUnderDailyExtractLimit, recordExtractSuccess } from './queue.js'

/** Wall-clock cap so a slow extract cannot stall the agent loop. */
export const MEMORY_FLUSH_TIMEOUT_MS = 15_000

export type FlushBeforeCompactOpts = {
  sessionId: string
  store: MemoryStore
  sessionStore: SessionMessagesLoader
  memoryService: MemoryService
  config?: MemoryFileConfig
  sessionConfig?: Pick<SessionConfig, 'generateMemories' | 'incognito' | 'cwd'>
  /** Override timeout (tests). */
  timeoutMs?: number
  now?: number
}

export type FlushBeforeCompactResult = {
  status: 'flushed' | 'skipped' | 'failed' | 'timeout'
  reason?: string
  phase1?: Phase1ExtractResult
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return new Promise((resolve) => {
    let done = false
    const t = setTimeout(() => {
      if (done) return
      done = true
      resolve('timeout')
    }, ms)
    if (typeof (t as NodeJS.Timeout).unref === 'function') {
      ;(t as NodeJS.Timeout).unref()
    }
    p.then(
      (v) => {
        if (done) return
        done = true
        clearTimeout(t)
        resolve(v)
      },
      () => {
        if (done) return
        done = true
        clearTimeout(t)
        resolve('timeout')
      },
    )
  })
}

/**
 * Run Phase1 extract for this session with idle gate forced open.
 * Skips when generate is off / incognito / no LLM / rate-limited.
 */
export async function flushMemoryBeforeCompact(
  opts: FlushBeforeCompactOpts,
): Promise<FlushBeforeCompactResult> {
  try {
    const config = opts.config ?? opts.memoryService.getConfig()
    const flags = resolveSessionMemoryFlags(config, opts.sessionConfig ?? {})
    if (!flags.generate || flags.incognito) {
      return { status: 'skipped', reason: flags.incognito ? 'incognito' : 'generate_disabled' }
    }

    const now = opts.now ?? Date.now()
    if (!assertUnderDailyExtractLimit(config, now, opts.memoryService)) {
      return { status: 'skipped', reason: 'rate_limited' }
    }

    const llm = createDefaultMemoryLlmClient({ extractModel: config.extractModel })
    if (!llm) {
      return { status: 'skipped', reason: 'no_llm' }
    }

    const timeoutMs = opts.timeoutMs ?? MEMORY_FLUSH_TIMEOUT_MS
    const phase1Promise = runPhase1Extract({
      store: opts.store,
      sessionStore: opts.sessionStore,
      sessionId: opts.sessionId,
      llm,
      config,
      sessionConfig: {
        generateMemories: opts.sessionConfig?.generateMemories,
        incognito: opts.sessionConfig?.incognito,
        cwd: typeof opts.sessionConfig?.cwd === 'string' ? opts.sessionConfig.cwd : undefined,
      },
      now,
      // Compact path: treat as idle so we don't wait for the 15m debounce.
      isIdle: true,
    })

    const raced = await withTimeout(phase1Promise, timeoutMs)
    if (raced === 'timeout') {
      opts.memoryService.recordPipelineStatus({
        lastPhase1At: now,
        lastPhase1Status: 'skipped',
        lastPhase1Reason: 'compact_flush_timeout',
        lastPhase1SessionId: opts.sessionId,
      })
      return { status: 'timeout', reason: 'timeout' }
    }

    const phase1 = raced
    opts.memoryService.recordPipelineStatus({
      lastPhase1At: now,
      lastPhase1Status:
        phase1.status === 'succeeded' || phase1.status === 'succeeded_no_output'
          ? phase1.status
          : phase1.status === 'skipped'
            ? 'skipped'
            : 'failed',
      lastPhase1Reason: phase1.reason,
      lastPhase1SessionId: opts.sessionId,
    })

    if (phase1.status === 'succeeded' || phase1.status === 'succeeded_no_output') {
      recordExtractSuccess(now, opts.memoryService)
      return { status: 'flushed', phase1 }
    }
    if (phase1.status === 'skipped') {
      return { status: 'skipped', reason: phase1.reason, phase1 }
    }
    return { status: 'failed', reason: phase1.reason, phase1 }
  } catch (err) {
    return {
      status: 'failed',
      reason: err instanceof Error ? err.message : String(err),
    }
  }
}
