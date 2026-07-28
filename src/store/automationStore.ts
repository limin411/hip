/**
 * Automation product store: catalog/runs persistence, sync in-flight claim,
 * runNow lifecycle, and post-session-list orphan recovery.
 *
 * Normative algorithms: docs/design/2026-07-27-automation-page.md
 */
import { create } from 'zustand'
import {
  listAutomations,
  saveAutomations,
  listAutomationRuns,
  saveAutomationRuns,
  softDeleteAutomation,
  restoreAutomationTrashEntry,
  listAutomationsTrash,
} from '@/ipc/automations'
import {
  type Automation,
  type AutomationRun,
  type AutomationRunStatus,
  type AutomationRunTrigger,
  type AutomationTrigger,
  mintAutomationId,
  mintAutomationRunId,
  normalizeAutomation,
  normalizeAutomationRun,
  truncateRuns,
  formatAutomationSessionTitle,
  classifySessionForAutomation,
  computeNextRunAt,
  rollNextRunAt,
  isAutomationNameTaken,
} from '@/domain/automations'
import { buildSessionConfigFromAutomation } from '@/domain/automations/buildSessionConfig'
import { sessionService } from '@/domain/sessionService'
import { useDomainStore } from '@/domain/sessionStore'
import { toast } from 'sonner'
import i18n from '@/i18n'

// ─── In-flight claim (sync, memory-only) ─────────────────────
// Disk run.status is NOT the claim — see recoverOrphanRuns on load.

const inFlight = new Set<string>()
let globalInFlight = 0
/** Bumps on claim/release so UI can subscribe without 1s polling. */
let inFlightVersion = 0
const inFlightListeners = new Set<() => void>()

function notifyInFlight(): void {
  inFlightVersion += 1
  for (const listener of inFlightListeners) listener()
}

/** Active watches: runId → { sessionId, automationId } (Host may subscribe later). */
const watches = new Map<string, { sessionId: string; automationId: string }>()

/**
 * Serialize runNow bodies so disk/session side effects cannot interleave
 * for concurrent tick+manual paths (workItemStore saveChain pattern).
 */
let runNowChain: Promise<void> = Promise.resolve()

/** Serialize dual-file IPC writes; snapshot state when the turn runs. */
let saveChain: Promise<void> = Promise.resolve()

function enqueueSave(run: () => Promise<void>): Promise<void> {
  const next = saveChain.then(run, run)
  saveChain = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

function enqueueRunNow(fn: () => Promise<void>): Promise<void> {
  const next = runNowChain.then(fn, fn)
  runNowChain = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

export function tryClaimInFlight(
  automationId: string,
  opts: { trigger: string },
): { ok: true } | { ok: false; error: 'skip_previous_running' | 'skip_global_cap' } {
  if (inFlight.has(automationId)) {
    return { ok: false, error: 'skip_previous_running' }
  }
  // Manual Run: only per-auto single-flight (user-initiated must not lose to global cap)
  if (opts.trigger !== 'manual' && globalInFlight >= 2) {
    return { ok: false, error: 'skip_global_cap' }
  }
  inFlight.add(automationId)
  globalInFlight++
  notifyInFlight()
  return { ok: true }
}

export function releaseInFlight(automationId: string): void {
  if (!inFlight.has(automationId)) return
  inFlight.delete(automationId)
  globalInFlight = Math.max(0, globalInFlight - 1)
  notifyInFlight()
}

/** Test / debug: whether an automation currently holds the claim. */
export function isInFlight(automationId: string): boolean {
  return inFlight.has(automationId)
}

export function getGlobalInFlight(): number {
  return globalInFlight
}

/** Subscribe to claim set changes (for useSyncExternalStore). */
export function subscribeInFlight(onStoreChange: () => void): () => void {
  inFlightListeners.add(onStoreChange)
  return () => {
    inFlightListeners.delete(onStoreChange)
  }
}

/** Snapshot version for useSyncExternalStore (changes on claim/release). */
export function getInFlightVersion(): number {
  return inFlightVersion
}

/** Current automation ids holding the in-flight claim. */
export function listInFlightIds(): string[] {
  return [...inFlight]
}

export function getWatch(
  runId: string,
): { sessionId: string; automationId: string } | undefined {
  return watches.get(runId)
}

/** Snapshot of open run watches for the schedule host session sampler. */
export function listWatches(): Array<{
  runId: string
  sessionId: string
  automationId: string
}> {
  return [...watches.entries()].map(([runId, w]) => ({
    runId,
    sessionId: w.sessionId,
    automationId: w.automationId,
  }))
}

export type RunNowOpts = {
  /** KD-13: true for Create-and-run / list manual Run; false for schedule/catchup */
  focus?: boolean
  trigger?: AutomationRunTrigger
  /** Alias accepted by UI; maps to trigger when trigger omitted */
  reason?: AutomationRunTrigger | string
  /** Injectable clock */
  nowMs?: number
}

export type BeginRunInput = {
  id: string
  automationId: string
  status: 'running' | 'pending'
  trigger: AutomationRunTrigger
  startedAt: number
  sessionId?: string | null
}

export type CompleteRunInput = {
  status: AutomationRunStatus
  error?: string | null
  finishedAt: number
}

export type FailBeforeSessionInput = {
  trigger: AutomationRunTrigger
  error: string
  now: number
}

export type RecordSkipInput = {
  trigger: AutomationRunTrigger
  error: string
  now: number
  rollNextRunAt?: boolean
}

export type CreateAutomationInput = {
  name?: string
  prompt?: string
  enabled?: boolean
  trigger?: AutomationTrigger
  projectPath?: string | null
  llmProvider?: string
  model?: string
  agentId?: string
  effort?: string
  permissionMode?: Automation['permissionMode']
  skillIds?: string[]
  templateId?: string | null
}

export interface AutomationStore {
  loaded: boolean
  loading: boolean
  error: string | null
  automations: Automation[]
  runs: AutomationRun[]
  /** True after first session:list:result (and reconnect lists). */
  sessionListReady: boolean
  /** Sidebar / list selection for run history panel. */
  selectedId: string | null
  /** Sidebar "New" sets this; AutomationsPage opens the create editor and clears it. */
  pendingCreate: boolean

  load: () => Promise<void>
  markSessionListReady: () => void
  recoverOrphanRuns: (nowMs?: number) => Promise<void>

  select: (id: string | null) => void
  requestCreate: () => void
  clearPendingCreate: () => void

  create: (input?: CreateAutomationInput) => Promise<string>
  update: (id: string, patch: Partial<Automation>) => Promise<void>
  /**
   * Soft-delete into product recycle bin (`trash/automations`).
   * Live catalog is updated by the Tauri command (not `saveCatalog()` alone).
   */
  remove: (id: string) => Promise<void>
  /** Restore a recycle-bin entry and reload it into the live store. */
  restoreTrashEntry: (entryId: string) => Promise<string>
  setEnabled: (id: string, enabled: boolean) => Promise<void>

  runNow: (automationId: string, opts?: RunNowOpts) => Promise<void>

  beginRun: (input: BeginRunInput) => Promise<void>
  completeRun: (runId: string, input: CompleteRunInput) => Promise<void>
  failBeforeSession: (
    automationId: string,
    input: FailBeforeSessionInput,
  ) => Promise<void>
  recordSkip: (automationId: string, input: RecordSkipInput) => Promise<void>
  patchRunStatus: (runId: string, status: AutomationRunStatus) => Promise<void>
  attachSessionToRun: (runId: string, sessionId: string) => Promise<void>
  registerWatch: (
    runId: string,
    sessionId: string,
    automationId: string,
  ) => void
  patchNextRunAt: (id: string, nextRunAt: number | null) => Promise<void>

  /** Enqueue save of current catalog snapshot. */
  saveCatalog: () => Promise<void>
  /** Enqueue save of current runs snapshot (truncated). */
  saveRuns: () => Promise<void>
}

// ─── helpers ─────────────────────────────────────────────────

function toCatalog(automations: Automation[]) {
  return { version: 1 as const, automations }
}

function toRunsLog(runs: AutomationRun[]) {
  return { version: 1 as const, runs: truncateRuns(runs) }
}

/**
 * Ordering key for "latest" run when reconciling catalog last*.
 *
 * Prefer finishedAt when present so a mid-run `skipped` row (claim reject while
 * the real session is still open) cannot outrank a later-finished succeeded run
 * that started earlier. Open runs (finishedAt null) fall back to startedAt.
 */
export function runRecencyMs(r: AutomationRun): number {
  return r.finishedAt ?? r.startedAt
}

/**
 * Re-derive denormalized last* from the newest run per automation (runs win).
 */
export function reconcileLastFromRuns(
  automations: Automation[],
  runs: AutomationRun[],
): Automation[] {
  if (automations.length === 0) return automations

  const latestByAuto = new Map<string, AutomationRun>()
  for (const r of runs) {
    const prev = latestByAuto.get(r.automationId)
    if (!prev || runRecencyMs(r) > runRecencyMs(prev)) {
      latestByAuto.set(r.automationId, r)
    }
  }

  let changed = false
  const out = automations.map((a) => {
    const latest = latestByAuto.get(a.id)
    if (!latest) return a
    const next: Automation = {
      ...a,
      lastRunAt: latest.startedAt,
      lastStatus: latest.status,
      lastError: latest.error ?? null,
      lastSessionId: latest.sessionId ?? null,
    }
    if (
      next.lastRunAt !== a.lastRunAt ||
      next.lastStatus !== a.lastStatus ||
      next.lastError !== a.lastError ||
      next.lastSessionId !== a.lastSessionId
    ) {
      changed = true
      return next
    }
    return a
  })
  return changed ? out : automations
}

function resolveTrigger(opts?: RunNowOpts): AutomationRunTrigger {
  const t = opts?.trigger ?? opts?.reason
  if (t === 'manual' || t === 'schedule' || t === 'catchup') return t
  return 'manual'
}

function findLatestRun(
  runs: AutomationRun[],
  automationId: string,
): AutomationRun | undefined {
  let best: AutomationRun | undefined
  for (const r of runs) {
    if (r.automationId !== automationId) continue
    if (!best || runRecencyMs(r) > runRecencyMs(best)) best = r
  }
  return best
}

function patchAutomationInList(
  list: Automation[],
  id: string,
  patch: Partial<Automation>,
): Automation[] {
  return list.map((a) => (a.id === id ? { ...a, ...patch } : a))
}

/** True when two triggers fire at the same local schedule (or both manual). */
function triggersEqual(a: AutomationTrigger, b: AutomationTrigger): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'manual') return true
  if (a.kind === 'daily' && b.kind === 'daily') {
    return a.hour === b.hour && a.minute === b.minute
  }
  if (a.kind === 'weekly' && b.kind === 'weekly') {
    return a.weekday === b.weekday && a.hour === b.hour && a.minute === b.minute
  }
  return false
}

// ─── store ───────────────────────────────────────────────────

export const useAutomationStore = create<AutomationStore>((set, get) => ({
  loaded: false,
  loading: false,
  error: null,
  automations: [],
  runs: [],
  sessionListReady: false,
  selectedId: null,
  pendingCreate: false,

  select: (id) => {
    set({ selectedId: id })
  },

  requestCreate: () => {
    set({ pendingCreate: true })
  },

  clearPendingCreate: () => {
    set({ pendingCreate: false })
  },

  load: async () => {
    set({ loading: true })
    try {
      const [catalog, runsLog] = await Promise.all([
        listAutomations(),
        listAutomationRuns(),
      ])
      const runs = truncateRuns(runsLog.runs)
      const automations = reconcileLastFromRuns(catalog.automations, runs)
      set({
        automations,
        runs,
        loaded: true,
        loading: false,
        error: null,
      })
      // Opportunistic trash badge hydrate (non-blocking).
      void listAutomationsTrash()
        .then((items) => {
          void import('@/store/trashBadgeStore').then(({ useTrashBadgeStore }) => {
            useTrashBadgeStore.getState().setAutomationCount(items.length)
          })
        })
        .catch(() => undefined)
      // Do NOT recoverOrphanRuns here — wait for sessionListReady.
    } catch (e) {
      set({
        loaded: true,
        loading: false,
        error: e instanceof Error ? e.message : 'Failed to load automations',
      })
    }
  },

  markSessionListReady: () => {
    set({ sessionListReady: true })
  },

  recoverOrphanRuns: async (nowMs = Date.now()) => {
    if (!get().sessionListReady) {
      // Cold start: sessions not yet applied — DO NOT force-fail open runs
      return
    }

    const open = get().runs.filter(
      (r) =>
        r.status === 'running' ||
        r.status === 'waiting_user' ||
        r.status === 'pending',
    )

    const sessions = useDomainStore.getState().sessions

    for (const r of open) {
      // Live runNow holds memory claim: never complete/interrupt that auto.
      // Between beginRun and attachSessionToRun sessionId is still null; a
      // concurrent session:list:result must not release the claim.
      if (inFlight.has(r.automationId)) {
        if (r.sessionId) {
          get().registerWatch(r.id, r.sessionId, r.automationId)
        }
        continue
      }

      // Still binding sessionId (no live claim either) — leave open; next
      // recover / host sample will resolve. Avoid process_interrupted race
      // if disk wrote beginRun but process died before attach (rare) — without
      // claim and without sessionId we treat as interrupted below only when
      // we have no binding in progress. Null sessionId + no claim = crash mid bind.
      if (!r.sessionId) {
        await get().completeRun(r.id, {
          status: 'failed',
          error: 'process_interrupted',
          finishedAt: nowMs,
        })
        continue
      }

      const session = sessions.find((s) => s.id === r.sessionId)

      // Unloaded list summaries always have status 'idle' (summaryToVM) and
      // drop HITL — not trustworthy for terminal success. Prefer interrupted.
      if (session && session.loaded === false) {
        await get().completeRun(r.id, {
          status: 'failed',
          error: 'process_interrupted',
          finishedAt: nowMs,
        })
        continue
      }

      const kind = classifySessionForAutomation(session)

      if (session && kind === 'in_flight') {
        if (!inFlight.has(r.automationId)) {
          inFlight.add(r.automationId)
          globalInFlight++
          notifyInFlight()
        }
        get().registerWatch(r.id, r.sessionId, r.automationId)
        continue
      }
      if (session && kind === 'waiting_user') {
        if (!inFlight.has(r.automationId)) {
          inFlight.add(r.automationId)
          globalInFlight++
          notifyInFlight()
        }
        if (r.status !== 'waiting_user') {
          await get().patchRunStatus(r.id, 'waiting_user')
        }
        get().registerWatch(r.id, r.sessionId, r.automationId)
        continue
      }
      if (session && kind === 'succeeded') {
        // Only when loaded VM is idle with no HITL (true completion evidence).
        await get().completeRun(r.id, {
          status: 'succeeded',
          error: null,
          finishedAt: nowMs,
        })
        continue
      }
      if (session && kind === 'failed') {
        await get().completeRun(r.id, {
          status: 'failed',
          error:
            session.error?.message ||
            session.error?.code ||
            'session_error',
          finishedAt: nowMs,
        })
        continue
      }
      // session missing (or classify failed with !session)
      await get().completeRun(r.id, {
        status: 'failed',
        error: 'process_interrupted',
        finishedAt: nowMs,
      })
    }
  },

  saveCatalog: () =>
    enqueueSave(async () => {
      try {
        await saveAutomations(toCatalog(get().automations))
        set({ error: null })
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : 'Failed to save automations'
        set({ error: msg })
        throw e
      }
    }),

  saveRuns: () =>
    enqueueSave(async () => {
      try {
        const truncated = truncateRuns(get().runs)
        if (truncated.length !== get().runs.length) {
          set({ runs: truncated })
        }
        await saveAutomationRuns(toRunsLog(get().runs))
        set({ error: null })
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : 'Failed to save automation runs'
        set({ error: msg })
        throw e
      }
    }),

  create: async (input = {}) => {
    const now = Date.now()
    const name = input.name ?? ''
    if (isAutomationNameTaken(name, get().automations)) {
      const msg = i18n.t('automation.editor.nameDuplicate', {
        name: name.trim(),
      })
      set({ error: msg })
      throw new Error(msg)
    }
    const trigger = input.trigger ?? { kind: 'manual' as const }
    const raw: Automation = {
      id: mintAutomationId(),
      name,
      prompt: input.prompt ?? '',
      enabled: input.enabled ?? true,
      trigger,
      createdAt: now,
      updatedAt: now,
      nextRunAt:
        trigger.kind === 'manual' ? null : computeNextRunAt(trigger, now),
      ...(input.projectPath !== undefined
        ? { projectPath: input.projectPath }
        : {}),
      ...(input.llmProvider ? { llmProvider: input.llmProvider } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.agentId ? { agentId: input.agentId } : {}),
      ...(input.effort ? { effort: input.effort } : {}),
      ...(input.permissionMode
        ? { permissionMode: input.permissionMode }
        : {}),
      ...(input.skillIds ? { skillIds: input.skillIds } : {}),
      ...(input.templateId !== undefined
        ? { templateId: input.templateId }
        : {}),
    }
    const a = normalizeAutomation(raw, now)
    if (!a) throw new Error('invalid automation')
    set((s) => ({ automations: [a, ...s.automations], error: null }))
    await get().saveCatalog()
    return a.id
  },

  update: async (id, patch) => {
    const now = Date.now()
    if (
      patch.name !== undefined &&
      isAutomationNameTaken(patch.name, get().automations, id)
    ) {
      const msg = i18n.t('automation.editor.nameDuplicate', {
        name: patch.name.trim(),
      })
      set({ error: msg })
      throw new Error(msg)
    }
    set((s) => {
      const automations = s.automations.map((a) => {
        if (a.id !== id) return a
        // Host fires from nextRunAt, not trigger fields — reseed when schedule changes.
        let nextRunAt = a.nextRunAt
        if (patch.nextRunAt !== undefined) {
          nextRunAt = patch.nextRunAt
        } else if (
          patch.trigger !== undefined &&
          !triggersEqual(a.trigger, patch.trigger)
        ) {
          nextRunAt =
            patch.trigger.kind === 'manual'
              ? null
              : computeNextRunAt(patch.trigger, now)
        }
        const merged = normalizeAutomation(
          { ...a, ...patch, id: a.id, nextRunAt, updatedAt: now },
          now,
        )
        return merged ?? { ...a, ...patch, nextRunAt, updatedAt: now }
      })
      return { automations, error: null }
    })
    await get().saveCatalog()
  },

  remove: async (id) => {
    // Soft-delete into recycle bin; runs may retain orphan automationId rows.
    const prev = get().automations.find((a) => a.id === id)
    if (!prev) return
    // Optimistic remove; Rust soft-delete rewrites catalog + trash atomically.
    set((s) => ({
      automations: s.automations.filter((a) => a.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
      error: null,
    }))
    // Drop claim/watch if any
    releaseInFlight(id)
    for (const [runId, w] of [...watches.entries()]) {
      if (w.automationId === id) watches.delete(runId)
    }
    try {
      await softDeleteAutomation(id)
      void import('@/store/trashBadgeStore').then(({ useTrashBadgeStore }) => {
        useTrashBadgeStore.getState().adjustAutomations(1)
      })
    } catch (e) {
      // Roll back optimistic removal and re-hydrate from disk.
      set({ error: e instanceof Error ? e.message : String(e) })
      try {
        await get().load()
      } catch {
        // keep error
      }
      throw e
    }
  },

  restoreTrashEntry: async (entryId) => {
    const a = await restoreAutomationTrashEntry(entryId)
    set((s) => {
      if (s.automations.some((x) => x.id === a.id)) {
        return {
          automations: s.automations.map((x) => (x.id === a.id ? a : x)),
          error: null,
        }
      }
      return { automations: [a, ...s.automations], error: null }
    })
    void import('@/store/trashBadgeStore').then(({ useTrashBadgeStore }) => {
      useTrashBadgeStore.getState().adjustAutomations(-1)
    })
    return a.id
  },

  setEnabled: async (id, enabled) => {
    const now = Date.now()
    set((s) => {
      const automations = s.automations.map((a) => {
        if (a.id !== id) return a
        let nextRunAt = a.nextRunAt
        if (enabled && a.trigger.kind !== 'manual') {
          // Seed next slot when enabling a schedule.
          nextRunAt = computeNextRunAt(a.trigger, now)
        }
        if (!enabled) {
          // Keep nextRunAt for display; host skips disabled.
        }
        return { ...a, enabled, nextRunAt, updatedAt: now }
      })
      return { automations, error: null }
    })
    await get().saveCatalog()
  },

  patchNextRunAt: async (id, nextRunAt) => {
    set((s) => ({
      automations: patchAutomationInList(s.automations, id, { nextRunAt }),
    }))
    await get().saveCatalog()
  },

  /**
   * Dual-file: runs FIRST, then catalog last*.
   * Does NOT release claim.
   */
  beginRun: async (input) => {
    const run: AutomationRun = {
      id: input.id,
      automationId: input.automationId,
      status: input.status,
      trigger: input.trigger,
      startedAt: input.startedAt,
      sessionId: input.sessionId ?? null,
      finishedAt: null,
      error: null,
    }
    const normalized = normalizeAutomationRun(run, input.startedAt) ?? run

    set((s) => ({
      runs: truncateRuns([normalized, ...s.runs]),
    }))
    await get().saveRuns()

    set((s) => ({
      automations: patchAutomationInList(s.automations, input.automationId, {
        lastRunAt: input.startedAt,
        lastStatus: input.status,
        lastError: null,
        lastSessionId: input.sessionId ?? null,
        updatedAt: Date.now(),
      }),
    }))
    await get().saveCatalog()
  },

  /**
   * Dual-file + releaseInFlight MUST (in finally so IPC throw cannot leak claim).
   * Rolls nextRunAt for scheduled autos.
   */
  completeRun: async (runId, input) => {
    const existing = get().runs.find((r) => r.id === runId)
    if (!existing) {
      // Still try release if we know automation via watch
      const w = watches.get(runId)
      if (w) {
        releaseInFlight(w.automationId)
        watches.delete(runId)
      }
      return
    }

    const automationId = existing.automationId
    try {
      const finished: AutomationRun = {
        ...existing,
        status: input.status,
        error: input.error ?? null,
        finishedAt: input.finishedAt,
      }

      set((s) => ({
        runs: s.runs.map((r) => (r.id === runId ? finished : r)),
      }))
      await get().saveRuns()

      const auto = get().automations.find((a) => a.id === automationId)
      let nextRunAt = auto?.nextRunAt ?? null
      if (auto && auto.trigger.kind !== 'manual') {
        nextRunAt = rollNextRunAt(auto.trigger, input.finishedAt)
      }

      set((s) => ({
        automations: patchAutomationInList(s.automations, automationId, {
          lastRunAt: existing.startedAt,
          lastStatus: input.status,
          lastError: input.error ?? null,
          lastSessionId: existing.sessionId ?? null,
          nextRunAt,
          updatedAt: Date.now(),
        }),
      }))
      await get().saveCatalog()
    } finally {
      // releaseInFlight MUST even when dual-file IPC throws
      releaseInFlight(automationId)
      watches.delete(runId)
    }
  },

  /**
   * Config/project/model fail BEFORE session create.
   * Writes a failed run row + last* + MUST releaseInFlight (finally).
   * Non-manual triggers roll nextRunAt so schedule ticks do not spam fails.
   */
  failBeforeSession: async (automationId, input) => {
    try {
      const runId = mintAutomationRunId()
      const run: AutomationRun = {
        id: runId,
        automationId,
        status: 'failed',
        trigger: input.trigger,
        startedAt: input.now,
        finishedAt: input.now,
        sessionId: null,
        error: input.error,
      }
      const normalized = normalizeAutomationRun(run, input.now) ?? run

      set((s) => ({
        runs: truncateRuns([normalized, ...s.runs]),
      }))
      await get().saveRuns()

      const auto = get().automations.find((a) => a.id === automationId)
      let nextRunAt = auto?.nextRunAt ?? null
      if (auto && auto.trigger.kind !== 'manual') {
        nextRunAt = rollNextRunAt(auto.trigger, input.now)
      }

      set((s) => ({
        automations: patchAutomationInList(s.automations, automationId, {
          lastRunAt: input.now,
          lastStatus: 'failed',
          lastError: input.error,
          lastSessionId: null,
          nextRunAt,
          updatedAt: Date.now(),
        }),
      }))
      await get().saveCatalog()
    } finally {
      // MUST releaseInFlight even when dual-file IPC throws
      releaseInFlight(automationId)
    }
  },

  /**
   * Skip without claim (skip_previous_running / skip_global_cap / miss).
   * Does NOT release.
   *
   * Always appends a runs-log row. Catalog last* is updated unless this auto
   * already holds the in-flight claim (claim-reject while a real run is open) —
   * otherwise lastStatus flips to "skipped" over a still-running / soon-to-succeed
   * session and stays wrong after reconcile-by-startedAt.
   */
  recordSkip: async (automationId, input) => {
    const runId = mintAutomationRunId()
    const run: AutomationRun = {
      id: runId,
      automationId,
      status: 'skipped',
      trigger: input.trigger,
      startedAt: input.now,
      finishedAt: input.now,
      sessionId: null,
      error: input.error,
    }
    const normalized = normalizeAutomationRun(run, input.now) ?? run

    set((s) => ({
      runs: truncateRuns([normalized, ...s.runs]),
    }))
    await get().saveRuns()

    // Real run still open: keep last* (running/waiting_user) for list UX.
    if (inFlight.has(automationId)) {
      return
    }

    const auto = get().automations.find((a) => a.id === automationId)
    let nextRunAt = auto?.nextRunAt ?? null
    if (input.rollNextRunAt && auto && auto.trigger.kind !== 'manual') {
      nextRunAt = rollNextRunAt(auto.trigger, input.now)
    }

    set((s) => ({
      automations: patchAutomationInList(s.automations, automationId, {
        lastRunAt: input.now,
        lastStatus: 'skipped',
        lastError: input.error,
        lastSessionId: null,
        nextRunAt,
        updatedAt: Date.now(),
      }),
    }))
    await get().saveCatalog()
  },

  /**
   * waiting_user (and similar): dual-file; claim STAYS held.
   */
  patchRunStatus: async (runId, status) => {
    const existing = get().runs.find((r) => r.id === runId)
    if (!existing) return

    set((s) => ({
      runs: s.runs.map((r) => (r.id === runId ? { ...r, status } : r)),
    }))
    await get().saveRuns()

    set((s) => ({
      automations: patchAutomationInList(s.automations, existing.automationId, {
        lastStatus: status,
        // Prefer latest run for last* when this is the newest for the auto.
        ...(findLatestRun(get().runs, existing.automationId)?.id === runId
          ? {
              lastRunAt: existing.startedAt,
              lastSessionId: existing.sessionId ?? null,
              lastError: existing.error ?? null,
            }
          : {}),
        updatedAt: Date.now(),
      }),
    }))
    await get().saveCatalog()
  },

  attachSessionToRun: async (runId, sessionId) => {
    const existing = get().runs.find((r) => r.id === runId)
    if (!existing) return

    set((s) => ({
      runs: s.runs.map((r) =>
        r.id === runId ? { ...r, sessionId } : r,
      ),
    }))
    await get().saveRuns()

    set((s) => ({
      automations: patchAutomationInList(s.automations, existing.automationId, {
        lastSessionId: sessionId,
        updatedAt: Date.now(),
      }),
    }))
    await get().saveCatalog()
  },

  registerWatch: (runId, sessionId, automationId) => {
    watches.set(runId, { sessionId, automationId })
  },

  runNow: (automationId, opts = {}) => {
    return enqueueRunNow(() => runNowBody(automationId, opts, get))
  },
}))

// ─── runNow body (normative) ─────────────────────────────────

async function runNowBody(
  automationId: string,
  opts: RunNowOpts,
  get: () => AutomationStore,
): Promise<void> {
  const now = opts.nowMs ?? Date.now()
  const trigger = resolveTrigger(opts)
  const a = get().automations.find((x) => x.id === automationId)
  if (!a) return

  // SYNC claim BEFORE any await (closes TOCTOU with concurrent onTick/manual)
  const claim = tryClaimInFlight(automationId, { trigger })
  if (!claim.ok) {
    await get().recordSkip(automationId, {
      trigger,
      error: claim.error,
      now,
    })
    if (trigger === 'manual') {
      toast.error(
        i18n.t(`automation.skipReasons.${claim.error}` as 'automation.skipReasons.skip_previous_running', {
          defaultValue: claim.error,
        }),
      )
    }
    return
  }

  let runId: string | null = null
  try {
    const built = await buildSessionConfigFromAutomation(a)
    if (!built.ok) {
      // failBeforeSession MUST releaseInFlight
      await get().failBeforeSession(automationId, {
        trigger,
        error: built.error,
        now,
      })
      if (trigger === 'manual') {
        toast.error(
          i18n.t(`automation.errors.${built.error}` as 'automation.errors.no_model_configured', {
            defaultValue: i18n.t(
              `automation.skipReasons.${built.error}` as 'automation.skipReasons.project_missing',
              { defaultValue: built.error },
            ),
          }),
        )
      }
      return
    }

    // Delete-vs-run race: re-check catalog after await; release if removed.
    const stillThere = get().automations.some((x) => x.id === automationId)
    if (!stillThere) {
      releaseInFlight(automationId)
      return
    }

    runId = mintAutomationRunId()
    await get().beginRun({
      id: runId,
      automationId,
      status: 'running',
      trigger,
      startedAt: now,
    })

    // Background lifecycle — MUST NOT steal active chat when focus=false
    const focus = opts.focus === true
    const sessionId = sessionService.createSession(built.config, {
      activate: focus,
    })
    // Always set title BEFORE send so tray notification copy is useful
    sessionService.renameSession(
      sessionId,
      formatAutomationSessionTitle(a.name),
    )

    if (focus) {
      sessionService.selectSession(sessionId)
    }

    sessionService.sendMessageToSession(sessionId, a.prompt)
    await get().attachSessionToRun(runId, sessionId)
    // Claim STAYS held until completeRun (including waiting_user).
    get().registerWatch(runId, sessionId, automationId)
  } catch (e) {
    if (runId) {
      await get().completeRun(runId, {
        status: 'failed',
        error: e instanceof Error ? e.message : 'run_threw',
        finishedAt: Date.now(),
      })
    } else {
      releaseInFlight(automationId)
    }
  }
}

/** Reset module-level claim/watch/chains between tests. */
export function __resetAutomationStoreInternalsForTests(): void {
  inFlight.clear()
  globalInFlight = 0
  inFlightVersion += 1
  for (const listener of inFlightListeners) listener()
  watches.clear()
  runNowChain = Promise.resolve()
  saveChain = Promise.resolve()
  useAutomationStore.setState({
    loaded: false,
    loading: false,
    error: null,
    automations: [],
    runs: [],
    sessionListReady: false,
    selectedId: null,
    pendingCreate: false,
  })
}
