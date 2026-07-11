import type { MemoryFileConfig, Message } from '@hip/protocol'
import type { MemoryService } from '../service.js'
import type { MemoryLlmClient } from '../llm-client.js'
import { createDefaultMemoryLlmClient } from '../llm-client.js'
import { resolveSessionMemoryFlags } from '../config.js'
import { runPhase1Extract } from './phase1-extract.js'
import { runPhase2Consolidate } from './phase2-consolidate.js'
import { resolveProjectKey } from '../project-key.js'
import type { MemoryStore } from '../store.js'

export type Phase1QueueJob = {
  sessionId: string
  store: MemoryStore
  sessionStore: { loadMessagesWithRuns(sessionId: string): Message[] }
  llm: MemoryLlmClient
  config: MemoryFileConfig
  sessionConfig?: { generateMemories?: boolean; incognito?: boolean; cwd?: string }
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
let processing = false
let concurrency = 1
let active = 0

/** Test hook: set concurrency (default 1). */
export function setPhase1QueueConcurrency(n: number): void {
  concurrency = Math.max(1, Math.floor(n))
}

/** Test hook: clear queue state. */
export function resetPhase1Queue(): void {
  queue.length = 0
  inflight.clear()
  processing = false
  active = 0
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
        const phase1 = await runPhase1Extract({
          store: job.store,
          sessionStore: job.sessionStore,
          sessionId: job.sessionId,
          llm: job.llm,
          config: job.config,
          sessionConfig: job.sessionConfig,
        })
        // After successful Phase1, enqueue Phase2 for same project (or global).
        if (phase1.status === 'succeeded' || phase1.status === 'succeeded_no_output') {
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
            await runPhase2Consolidate({
              store: job.store,
              llm: job.llm,
              config: job.config,
              projectKeyHash,
              projectKey,
            })
          } catch (err) {
            console.warn(
              '[memory-queue] phase2 failed',
              job.sessionId,
              err instanceof Error ? err.message : String(err),
            )
          }
        }
      } catch (err) {
        console.warn(
          '[memory-queue] phase1 failed',
          job.sessionId,
          err instanceof Error ? err.message : String(err),
        )
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
 * Fire-and-forget schedule after a successful turn.
 * Checks generate/incognito flags; builds a default LLM client; enqueues Phase1.
 */
export function scheduleMemoryExtractAfterTurn(host: SessionHostLike): void {
  void maybeEnqueueMemoryExtract(host)
}

/** Checks flags and enqueues; no-op when generate is off / incognito / missing deps. */
export function maybeEnqueueMemoryExtract(host: SessionHostLike): void {
  try {
    const svc = host.memoryService
    const sessionStore = host.store
    if (!svc || !sessionStore) return

    const config = svc.getConfig()
    const flags = resolveSessionMemoryFlags(config, host._config)
    if (!flags.generate || flags.incognito) return

    const llm = createDefaultMemoryLlmClient({ extractModel: config.extractModel })
    if (!llm) return

    enqueuePhase1({
      sessionId: host.id,
      store: svc.store,
      sessionStore,
      llm,
      config,
      sessionConfig: {
        generateMemories: host._config.generateMemories,
        incognito: host._config.incognito,
        cwd: host._config.cwd,
      },
    })
  } catch (err) {
    console.warn(
      '[memory] scheduleMemoryExtractAfterTurn failed',
      err instanceof Error ? err.message : String(err),
    )
  }
}
