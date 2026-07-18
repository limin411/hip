/**
 * Manual "Learn now" path for dogfood: if no pending stage1, run Phase1 on
 * recent chat sessions (skip idle/interval gates), then Phase2 consolidate.
 */
import type { MemoryFileConfig, SessionConfig } from '@hip/protocol'
import type { Message } from '@hip/protocol'
import type { MemoryService } from '../service.js'
import type { MemoryLlmClient } from '../llm-client.js'
import type { MemoryStore } from '../store.js'
import { runPhase1Extract, type Phase1ExtractResult } from './phase1-extract.js'
import { runPhase2Consolidate, type Phase2ConsolidateResult } from './phase2-consolidate.js'
import { assertUnderDailyExtractLimit, recordExtractSuccess } from './queue.js'
import { runDecayJob } from './evolution.js'
import { runTrashRetentionJob } from '../trash.js'

const MAX_SESSIONS_TO_TRY = 5

export type LearnNowSessionStore = {
  loadMessagesWithRuns(sessionId: string): Message[]
  listSessions?(): Array<{ id: string; messageCount: number; config?: string }>
}

export type LearnNowPhase1Summary = {
  tried: number
  succeeded: number
  /** Last skip/fail reason if no success. */
  lastReason?: string
  sessionId?: string
}

export type LearnNowResult = {
  phase1: LearnNowPhase1Summary
  phase2: Phase2ConsolidateResult
}

export type RunLearnNowOpts = {
  store: MemoryStore
  memoryService: MemoryService
  llm: MemoryLlmClient | null
  config: MemoryFileConfig
  sessionStore?: LearnNowSessionStore | null
  projectKeyHash?: string
  /** Cap how many recent sessions to try for Phase1. */
  maxSessions?: number
  now?: number
}

function parseSessionConfig(raw: string | undefined): SessionConfig | undefined {
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as SessionConfig
  } catch {
    return undefined
  }
}

/**
 * When stage1 is empty, extract from recent sessions (manual path: idle OK,
 * interval ignored; daily cap still applies). Then always run Phase2.
 */
export async function runLearnNow(opts: RunLearnNowOpts): Promise<LearnNowResult> {
  const now = opts.now ?? Date.now()
  const config = opts.config
  const phase1: LearnNowPhase1Summary = { tried: 0, succeeded: 0 }

  const pending = opts.store.countStage1Pending()
  if (
    pending === 0 &&
    config.generateMemories &&
    opts.sessionStore?.loadMessagesWithRuns &&
    opts.sessionStore.listSessions
  ) {
    if (!opts.llm) {
      phase1.lastReason = 'no_llm'
    } else if (!assertUnderDailyExtractLimit(config, now, opts.memoryService)) {
      phase1.lastReason = 'rate_limited'
    } else {
      const sessions = opts.sessionStore.listSessions()
      const minTurns = config.minUserTurns ?? 2
      const candidates = sessions
        .filter((s) => (s.messageCount ?? 0) >= minTurns)
        .slice(0, opts.maxSessions ?? MAX_SESSIONS_TO_TRY)

      for (const s of candidates) {
        phase1.tried += 1
        const sessionConfig = parseSessionConfig(s.config)
        if (sessionConfig?.incognito) {
          phase1.lastReason = 'incognito'
          continue
        }
        const result: Phase1ExtractResult = await runPhase1Extract({
          store: opts.store,
          sessionStore: opts.sessionStore,
          sessionId: s.id,
          llm: opts.llm,
          config,
          sessionConfig: {
            generateMemories: true,
            incognito: sessionConfig?.incognito,
            cwd: typeof sessionConfig?.cwd === 'string' ? sessionConfig.cwd : undefined,
          },
          now,
          // Manual learn: treat as idle; do not re-check interval.
          isIdle: true,
        })

        opts.memoryService.recordPipelineStatus({
          lastPhase1At: now,
          lastPhase1Status:
            result.status === 'succeeded' || result.status === 'succeeded_no_output'
              ? result.status
              : result.status === 'skipped'
                ? 'skipped'
                : 'failed',
          lastPhase1Reason: result.reason,
          lastPhase1SessionId: s.id,
        })

        if (result.status === 'succeeded' || result.status === 'succeeded_no_output') {
          recordExtractSuccess(now, opts.memoryService)
          if (result.status === 'succeeded') {
            phase1.succeeded += 1
            phase1.sessionId = s.id
            phase1.lastReason = undefined
            // One successful extract is enough for dogfood; consolidate next.
            break
          }
          phase1.lastReason = result.reason ?? 'succeeded_no_output'
        } else {
          phase1.lastReason = result.reason ?? result.status
        }

        if (!assertUnderDailyExtractLimit(config, now, opts.memoryService)) {
          phase1.lastReason = phase1.lastReason ?? 'rate_limited'
          break
        }
      }

      if (phase1.tried === 0 && !phase1.lastReason) {
        phase1.lastReason = 'no_eligible_session'
      }
    }
  }

  const phase2 = await runPhase2Consolidate({
    store: opts.store,
    llm: opts.llm,
    config,
    projectKeyHash: opts.projectKeyHash,
    now,
    onMutation: (scopes) => opts.memoryService.afterMemoryMutation(scopes),
  })

  if (phase2.status === 'succeeded' || phase2.status === 'succeeded_no_output') {
    try {
      const decay = runDecayJob(opts.store, config)
      if (decay.archived > 0) opts.memoryService.afterMemoryMutation({ all: true })
    } catch {
      // best-effort
    }
    try {
      runTrashRetentionJob(opts.store, config)
    } catch {
      // best-effort
    }
  }

  return { phase1, phase2 }
}

/** Compact detail string for memory:pipeline and UI parsing. */
export function formatLearnNowDetail(result: LearnNowResult): string {
  const { phase1, phase2 } = result
  const parts = [
    `upserted=${phase2.upserted ?? 0}`,
    `archived=${phase2.archived ?? 0}`,
    `extracted=${phase1.succeeded}`,
    `phase1Tried=${phase1.tried}`,
  ]
  if (phase1.lastReason) parts.push(`phase1Reason=${phase1.lastReason}`)
  if (phase2.reason) parts.push(`phase2Reason=${phase2.reason}`)
  if (phase2.status === 'skipped') parts.push(`skipped=${phase2.reason ?? 'skipped'}`)
  return parts.join(';')
}
