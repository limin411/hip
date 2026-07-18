import type { MemoryFileConfig, Message } from '@hip/protocol'
import type { MemoryService } from '../service.js'
import type { MemoryLlmClient } from '../llm-client.js'
import { createDefaultMemoryLlmClient } from '../llm-client.js'
import { resolveSessionMemoryFlags } from '../config.js'
import { runPhase1Extract } from './phase1-extract.js'
import { runPhase2Consolidate } from './phase2-consolidate.js'
import { runDecayJob } from './evolution.js'
import { resolveProjectKey } from '../project-key.js'
import type { MemoryStore } from '../store.js'

export type Phase1QueueJob = {
  sessionId: string
  store: MemoryStore
  sessionStore: { loadMessagesWithRuns(sessionId: string): Message[] }
  llm: MemoryLlmClient
  config: MemoryFileConfig
  sessionConfig?: { generateMemories?: boolean; incognito?: boolean; cwd?: string }
  /** When set, persist throttle/status and multi-scope mutation. */
  memoryService?: MemoryService
}

type SessionHostLike = {
  id: string
  _config: {
    generateMemories?: boolean
    incognito?: boolean
    cwd?: string
  }
  store?: { loadMessagesWithRuns(sessionId: string): Message[] }
  memoryService?: MemoryService
}

const queue: Phase1QueueJob[] = []
/** Sessions currently queued or running — prevents duplicate Phase1 for the same session. */
const inflight = new Set<string>()
/** Idle debounce timers: reset on each turn for the session. */
const idleTimers = new Map<string, ReturnType<typeof setTimeout>>()
/** Last successful Phase1 extract time per session (in-memory; V1). */
const lastExtractSuccessAt = new Map<string, number>()
/** Successful Phase1 extracts per UTC day (in-memory; V1). */
let extractCountByDay = { day: '', count: 0 }
let processing = false
let concurrency = 1
let active = 0

function todayKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10)
}

function hydrateExtractCountFromService(svc?: MemoryService, now = Date.now()): void {
  if (!svc) return
  try {
    const { day, count } = svc.getExtractsToday()
    const today = todayKey(now)
    if (day !== today) return
    // Merge L1 (process) with L2 (durable): take the higher so in-process
    // increments are not wiped by a stale or zero L2 read.
    if (extractCountByDay.day !== today) {
      extractCountByDay = { day, count }
    } else {
      extractCountByDay = { day, count: Math.max(extractCountByDay.count, count) }
    }
  } catch {
    // ignore
  }
}

/** True when more Phase1 extracts are allowed today under maxExtractsPerDay. */
export function assertUnderDailyExtractLimit(
  config: MemoryFileConfig,
  now = Date.now(),
  svc?: MemoryService,
): boolean {
  hydrateExtractCountFromService(svc, now)
  const max = config.maxExtractsPerDay ?? 20
  const day = todayKey(now)
  if (extractCountByDay.day !== day) extractCountByDay = { day, count: 0 }
  return extractCountByDay.count < max
}

/** Count a Phase1 success toward the daily extract limit (UTC day). */
export function recordExtractSuccess(now = Date.now(), svc?: MemoryService): void {
  hydrateExtractCountFromService(svc, now)
  const day = todayKey(now)
  if (extractCountByDay.day !== day) extractCountByDay = { day, count: 0 }
  extractCountByDay.count += 1
  try {
    svc?.recordExtractsToday(extractCountByDay.count, day)
  } catch {
    // ignore
  }
}

function resolveLastExtractAt(sessionId: string, svc?: MemoryService): number | undefined {
  const mem = lastExtractSuccessAt.get(sessionId)
  if (mem !== undefined) return mem
  const durable = svc?.getSessionLastExtractAt(sessionId)
  if (durable !== undefined) {
    lastExtractSuccessAt.set(sessionId, durable)
    return durable
  }
  return undefined
}

function setLastExtractAt(sessionId: string, atMs: number, svc?: MemoryService): void {
  lastExtractSuccessAt.set(sessionId, atMs)
  try {
    svc?.setSessionLastExtractAt(sessionId, atMs)
  } catch {
    // ignore
  }
}

/** Test hook: set concurrency (default 1). */
export function setPhase1QueueConcurrency(n: number): void {
  concurrency = Math.max(1, Math.floor(n))
}

/** Test hook: clear queue state (including idle timers + extract timestamps + daily counter). */
export function resetPhase1Queue(): void {
  for (const t of idleTimers.values()) clearTimeout(t)
  idleTimers.clear()
  lastExtractSuccessAt.clear()
  extractCountByDay = { day: '', count: 0 }
  queue.length = 0
  inflight.clear()
  processing = false
  active = 0
}

/** Test hook: record a prior extract success (for minExtractIntervalHours tests). */
export function setLastExtractSuccessAt(sessionId: string, atMs: number): void {
  lastExtractSuccessAt.set(sessionId, atMs)
}

/**
 * Enqueue a Phase1 extract job. Dedupes by sessionId while a job is queued/running.
 * processQueue runs with concurrency 1 by default.
 */
export function enqueuePhase1(job: Phase1QueueJob): boolean {
  if (inflight.has(job.sessionId)) return false
  inflight.add(job.sessionId)
  queue.push(job)
  void processQueue()
  return true
}

/** Drain the queue with limited concurrency. Safe to call repeatedly. */
export async function processQueue(): Promise<void> {
  if (processing) return
  processing = true
  try {
    while (queue.length > 0 && active < concurrency) {
      const job = queue.shift()
      if (!job) break
      active += 1
      // Sequential await when concurrency=1; keeps process simple and testable.
      try {
        const svc = job.memoryService
        if (!assertUnderDailyExtractLimit(job.config, Date.now(), svc)) {
          console.warn('[memory-queue] phase1 skipped rate_limited', job.sessionId)
          svc?.recordPipelineStatus({
            lastPhase1At: Date.now(),
            lastPhase1Status: 'skipped',
            lastPhase1Reason: 'rate_limited',
            lastPhase1SessionId: job.sessionId,
          })
        } else {
          const phase1 = await runPhase1Extract({
            store: job.store,
            sessionStore: job.sessionStore,
            sessionId: job.sessionId,
            llm: job.llm,
            config: job.config,
            sessionConfig: job.sessionConfig,
          })
          svc?.recordPipelineStatus({
            lastPhase1At: Date.now(),
            lastPhase1Status: phase1.status,
            lastPhase1Reason: phase1.reason,
            lastPhase1SessionId: job.sessionId,
          })
          // After Phase1 success (incl. empty): count daily cost; interval only on real success
          // unless throttleOnEmptyExtract is true (KD-12).
          if (phase1.status === 'succeeded' || phase1.status === 'succeeded_no_output') {
            recordExtractSuccess(Date.now(), svc)
            const countEmptyAsInterval = job.config.throttleOnEmptyExtract === true
            if (phase1.status === 'succeeded' || countEmptyAsInterval) {
              setLastExtractAt(job.sessionId, Date.now(), svc)
            }
            let projectKeyHash: string | undefined
            let projectKey: string | undefined
            const cwd = job.sessionConfig?.cwd
            if (cwd) {
              try {
                const pk = resolveProjectKey(cwd)
                projectKeyHash = pk.projectKeyHash
                projectKey = pk.projectKey
              } catch {
                // best-effort
              }
            }
            try {
              const phase2 = await runPhase2Consolidate({
                store: job.store,
                llm: job.llm,
                config: job.config,
                projectKeyHash,
                projectKey,
                onMutation: svc
                  ? (scopes) => svc.afterMemoryMutation(scopes)
                  : undefined,
              })
              svc?.recordPipelineStatus({
                lastPhase2At: Date.now(),
                lastPhase2Status: phase2.status,
                lastPhase2Reason: phase2.reason,
              })
              // Best-effort decay after a successful Phase2 run.
              if (phase2.status === 'succeeded' || phase2.status === 'succeeded_no_output') {
                try {
                  const decay = runDecayJob(job.store, job.config)
                  if (decay.archived > 0 && svc) {
                    svc.afterMemoryMutation({ all: true })
                  }
                } catch (err) {
                  console.warn(
                    '[memory-queue] decay failed',
                    err instanceof Error ? err.message : String(err),
                  )
                }
              }
            } catch (err) {
              console.warn(
                '[memory-queue] phase2 failed',
                job.sessionId,
                err instanceof Error ? err.message : String(err),
              )
              svc?.recordPipelineStatus({
                lastPhase2At: Date.now(),
                lastPhase2Status: 'failed',
                lastPhase2Reason: err instanceof Error ? err.message : String(err),
              })
            }
          } else if (phase1.status === 'skipped' || phase1.status === 'failed') {
            // status already recorded
          }
        }
      } catch (err) {
        console.warn(
          '[memory-queue] phase1 failed',
          job.sessionId,
          err instanceof Error ? err.message : String(err),
        )
        job.memoryService?.recordPipelineStatus({
          lastPhase1At: Date.now(),
          lastPhase1Status: 'failed',
          lastPhase1Reason: err instanceof Error ? err.message : String(err),
          lastPhase1SessionId: job.sessionId,
        })
      } finally {
        inflight.delete(job.sessionId)
        active -= 1
      }
    }
  } finally {
    processing = false
    // More work may have been enqueued while we drained.
    if (queue.length > 0) void processQueue()
  }
}

/**
 * After a successful turn: debounce Phase1 extract until the session has been
 * idle for `idleMinutes` (default 15). New turns cancel/reset the timer.
 *
 * `idleMinutes: 0` is intentional (E2E / accelerated configs): uses `??` not `||`
 * so zero schedules via `setTimeout(0)` on the next macrotask, still debounced.
 */
export function scheduleMemoryExtractAfterTurn(host: SessionHostLike): void {
  try {
    const svc = host.memoryService
    if (!svc || !host.store) return

    const config = svc.getConfig()
    const flags = resolveSessionMemoryFlags(config, host._config)
    if (!flags.generate || flags.incognito) return

    const sessionId = host.id
    const prev = idleTimers.get(sessionId)
    if (prev) clearTimeout(prev)

    // Use nullish coalescing so idleMinutes: 0 is not replaced by 15.
    const idleMs = (config.idleMinutes ?? 15) * 60_000
    const timer = setTimeout(() => {
      idleTimers.delete(sessionId)
      maybeEnqueueMemoryExtract(host)
    }, idleMs)
    // Don't keep the process alive solely for extract debounce.
    if (typeof (timer as NodeJS.Timeout).unref === 'function') {
      ;(timer as NodeJS.Timeout).unref()
    }
    idleTimers.set(sessionId, timer)
  } catch (err) {
    console.warn(
      '[memory] scheduleMemoryExtractAfterTurn failed',
      err instanceof Error ? err.message : String(err),
    )
  }
}

/**
 * Checks flags / min interval and enqueues; no-op when generate is off / incognito /
 * missing deps / still within minExtractIntervalHours of last success.
 */
export function maybeEnqueueMemoryExtract(host: SessionHostLike): void {
  try {
    const svc = host.memoryService
    const sessionStore = host.store
    if (!svc || !sessionStore) return

    const config = svc.getConfig()
    const flags = resolveSessionMemoryFlags(config, host._config)
    if (!flags.generate || flags.incognito) return

    const intervalHours = config.minExtractIntervalHours ?? 6
    const last = resolveLastExtractAt(host.id, svc)
    if (last !== undefined && Date.now() - last < intervalHours * 3_600_000) {
      svc.recordPipelineStatus({
        lastPhase1At: Date.now(),
        lastPhase1Status: 'skipped',
        lastPhase1Reason: 'interval_throttle',
        lastPhase1SessionId: host.id,
      })
      return
    }

    if (!assertUnderDailyExtractLimit(config, Date.now(), svc)) {
      console.warn('[memory] phase1 skipped rate_limited', host.id)
      svc.recordPipelineStatus({
        lastPhase1At: Date.now(),
        lastPhase1Status: 'skipped',
        lastPhase1Reason: 'rate_limited',
        lastPhase1SessionId: host.id,
      })
      return
    }

    const llm = createDefaultMemoryLlmClient({ extractModel: config.extractModel })
    if (!llm) {
      svc.recordPipelineStatus({
        lastPhase1At: Date.now(),
        lastPhase1Status: 'skipped',
        lastPhase1Reason: 'no_llm',
        lastPhase1SessionId: host.id,
      })
      return
    }

    enqueuePhase1({
      sessionId: host.id,
      store: svc.store,
      sessionStore,
      llm,
      config,
      memoryService: svc,
      sessionConfig: {
        generateMemories: host._config.generateMemories,
        incognito: host._config.incognito,
        cwd: host._config.cwd,
      },
    })
  } catch (err) {
    console.warn(
      '[memory] maybeEnqueueMemoryExtract failed',
      err instanceof Error ? err.message : String(err),
    )
  }
}
