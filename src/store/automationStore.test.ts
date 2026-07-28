import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Automation, AutomationRun } from '@/domain/automations'
import { DEFAULT_CONFIG } from '@/domain/sessionStore'
import type { SessionConfig } from '@hip/protocol'

const listAutomations = vi.fn()
const saveAutomations = vi.fn()
const listAutomationRuns = vi.fn()
const saveAutomationRuns = vi.fn()

vi.mock('@/ipc/automations', () => ({
  listAutomations: (...a: unknown[]) => listAutomations(...a),
  saveAutomations: (...a: unknown[]) => saveAutomations(...a),
  listAutomationRuns: (...a: unknown[]) => listAutomationRuns(...a),
  saveAutomationRuns: (...a: unknown[]) => saveAutomationRuns(...a),
}))

const createSession = vi.fn()
const sendMessageToSession = vi.fn()
const renameSession = vi.fn()
const selectSession = vi.fn()

vi.mock('@/domain/sessionService', () => ({
  sessionService: {
    createSession: (...a: unknown[]) => createSession(...a),
    sendMessageToSession: (...a: unknown[]) => sendMessageToSession(...a),
    renameSession: (...a: unknown[]) => renameSession(...a),
    selectSession: (...a: unknown[]) => selectSession(...a),
  },
}))

const buildSessionConfigFromAutomation = vi.fn()

vi.mock('@/domain/automations/buildSessionConfig', () => ({
  buildSessionConfigFromAutomation: (...a: unknown[]) =>
    buildSessionConfigFromAutomation(...a),
}))

// Domain store sessions for recoverOrphanRuns
const domainSessions: Array<{
  id: string
  status: 'idle' | 'running' | 'error'
  /** false = list summary only (summaryToVM); true = full VM with reliable status */
  loaded?: boolean
  pendingPermission?: unknown | null
  interrupt?: unknown | null
  planApprovalPending?: boolean | null
  error?: { message?: string; code?: string } | null
}> = []

vi.mock('@/domain/sessionStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/sessionStore')>()
  return {
    ...actual,
    useDomainStore: {
      getState: () => ({
        sessions: domainSessions,
      }),
    },
  }
})

import {
  useAutomationStore,
  __resetAutomationStoreInternalsForTests,
  tryClaimInFlight,
  releaseInFlight,
  isInFlight,
  getGlobalInFlight,
  getWatch,
  reconcileLastFromRuns,
} from './automationStore'

function auto(partial: Partial<Automation> & { id: string }): Automation {
  return {
    name: 'Daily standup',
    prompt: 'summarize',
    enabled: true,
    trigger: { kind: 'manual' },
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  }
}

function run(partial: Partial<AutomationRun> & { id: string; automationId: string }): AutomationRun {
  return {
    status: 'running',
    trigger: 'manual',
    startedAt: 100,
    ...partial,
  }
}

const okConfig: SessionConfig = {
  ...DEFAULT_CONFIG,
  surface: 'chat',
  llmProvider: 'openai',
  model: 'gpt-4o',
}

describe('automationStore', () => {
  beforeEach(() => {
    __resetAutomationStoreInternalsForTests()
    domainSessions.length = 0
    listAutomations.mockReset().mockResolvedValue({ version: 1, automations: [] })
    saveAutomations.mockReset().mockResolvedValue(undefined)
    listAutomationRuns.mockReset().mockResolvedValue({ version: 1, runs: [] })
    saveAutomationRuns.mockReset().mockResolvedValue(undefined)
    createSession.mockReset().mockImplementation(() => `sess_${createSession.mock.calls.length}`)
    sendMessageToSession.mockReset()
    renameSession.mockReset()
    selectSession.mockReset()
    buildSessionConfigFromAutomation.mockReset().mockResolvedValue({
      ok: true,
      config: okConfig,
    })
  })

  afterEach(() => {
    __resetAutomationStoreInternalsForTests()
  })

  // ─── load / reconcile ──────────────────────────────────────

  it('load hydrates catalog + runs and reconciles last* from runs SoT', async () => {
    const a = auto({
      id: 'auto_x1',
      lastStatus: 'succeeded',
      lastRunAt: 50,
      lastSessionId: 'old',
    })
    const r = run({
      id: 'arun_1',
      automationId: 'auto_x1',
      status: 'failed',
      startedAt: 200,
      sessionId: 's-new',
      error: 'boom',
    })
    listAutomations.mockResolvedValueOnce({ version: 1, automations: [a] })
    listAutomationRuns.mockResolvedValueOnce({ version: 1, runs: [r] })

    await useAutomationStore.getState().load()
    const st = useAutomationStore.getState()
    expect(st.loaded).toBe(true)
    expect(st.automations).toHaveLength(1)
    expect(st.automations[0].lastStatus).toBe('failed')
    expect(st.automations[0].lastRunAt).toBe(200)
    expect(st.automations[0].lastSessionId).toBe('s-new')
    expect(st.automations[0].lastError).toBe('boom')
    expect(st.runs).toHaveLength(1)
  })

  it('reconcileLastFromRuns is pure and prefers newest startedAt', () => {
    const a = auto({ id: 'auto_r', lastStatus: 'running', lastRunAt: 1 })
    const runs = [
      run({ id: 'arun_a', automationId: 'auto_r', status: 'running', startedAt: 10 }),
      run({
        id: 'arun_b',
        automationId: 'auto_r',
        status: 'succeeded',
        startedAt: 20,
        sessionId: 's1',
      }),
    ]
    const out = reconcileLastFromRuns([a], runs)
    expect(out[0].lastStatus).toBe('succeeded')
    expect(out[0].lastRunAt).toBe(20)
    expect(out[0].lastSessionId).toBe('s1')
  })

  // ─── CRUD ──────────────────────────────────────────────────

  it('create persists catalog and returns id', async () => {
    const id = await useAutomationStore.getState().create({
      name: 'N',
      prompt: 'P',
      trigger: { kind: 'daily', hour: 9, minute: 0 },
    })
    expect(id.startsWith('auto_')).toBe(true)
    expect(useAutomationStore.getState().automations[0].name).toBe('N')
    expect(useAutomationStore.getState().automations[0].nextRunAt).toEqual(
      expect.any(Number),
    )
    expect(saveAutomations).toHaveBeenCalled()
  })

  it('update / setEnabled / remove touch catalog', async () => {
    useAutomationStore.setState({
      automations: [auto({ id: 'auto_u', enabled: true })],
      loaded: true,
    })
    await useAutomationStore.getState().update('auto_u', { name: 'Renamed' })
    expect(useAutomationStore.getState().automations[0].name).toBe('Renamed')

    await useAutomationStore.getState().setEnabled('auto_u', false)
    expect(useAutomationStore.getState().automations[0].enabled).toBe(false)

    await useAutomationStore.getState().remove('auto_u')
    expect(useAutomationStore.getState().automations).toHaveLength(0)
    expect(saveAutomations.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it('select sets selectedId; remove clears selection for that id', async () => {
    useAutomationStore.setState({
      automations: [
        auto({ id: 'auto_a' }),
        auto({ id: 'auto_b' }),
      ],
      loaded: true,
      selectedId: null,
    })
    useAutomationStore.getState().select('auto_a')
    expect(useAutomationStore.getState().selectedId).toBe('auto_a')

    await useAutomationStore.getState().remove('auto_b')
    expect(useAutomationStore.getState().selectedId).toBe('auto_a')

    await useAutomationStore.getState().remove('auto_a')
    expect(useAutomationStore.getState().selectedId).toBeNull()
  })

  it('requestCreate / clearPendingCreate toggles pendingCreate', () => {
    expect(useAutomationStore.getState().pendingCreate).toBe(false)
    useAutomationStore.getState().requestCreate()
    expect(useAutomationStore.getState().pendingCreate).toBe(true)
    useAutomationStore.getState().clearPendingCreate()
    expect(useAutomationStore.getState().pendingCreate).toBe(false)
  })

  // ─── claim lock ────────────────────────────────────────────

  it('tryClaimInFlight is sync and blocks second claim on same id', () => {
    expect(tryClaimInFlight('auto_1', { trigger: 'manual' })).toEqual({ ok: true })
    expect(tryClaimInFlight('auto_1', { trigger: 'schedule' })).toEqual({
      ok: false,
      error: 'skip_previous_running',
    })
    expect(isInFlight('auto_1')).toBe(true)
    releaseInFlight('auto_1')
    expect(isInFlight('auto_1')).toBe(false)
    expect(tryClaimInFlight('auto_1', { trigger: 'manual' }).ok).toBe(true)
  })

  it('global cap of 2 applies to non-manual triggers only', () => {
    expect(tryClaimInFlight('auto_a', { trigger: 'schedule' }).ok).toBe(true)
    expect(tryClaimInFlight('auto_b', { trigger: 'catchup' }).ok).toBe(true)
    expect(tryClaimInFlight('auto_c', { trigger: 'schedule' })).toEqual({
      ok: false,
      error: 'skip_global_cap',
    })
    // Manual still allowed despite global cap
    expect(tryClaimInFlight('auto_d', { trigger: 'manual' }).ok).toBe(true)
    expect(getGlobalInFlight()).toBe(3)
  })

  // ─── dual-file order ───────────────────────────────────────

  it('beginRun writes runs then catalog', async () => {
    useAutomationStore.setState({
      automations: [auto({ id: 'auto_b' })],
      loaded: true,
    })
    const order: string[] = []
    saveAutomationRuns.mockImplementation(async () => {
      order.push('runs')
    })
    saveAutomations.mockImplementation(async () => {
      order.push('catalog')
    })

    await useAutomationStore.getState().beginRun({
      id: 'arun_begin',
      automationId: 'auto_b',
      status: 'running',
      trigger: 'manual',
      startedAt: 500,
    })

    expect(order[0]).toBe('runs')
    expect(order).toContain('catalog')
    expect(order.indexOf('runs')).toBeLessThan(order.indexOf('catalog'))
    expect(useAutomationStore.getState().runs[0].id).toBe('arun_begin')
    expect(useAutomationStore.getState().automations[0].lastStatus).toBe('running')
  })

  // ─── concurrent runNow (enqueue + claim hold) ──────────────
  // Note: global enqueueRunNow serializes bodies, so the second body starts
  // only after the first finishes. This asserts post-body claim hold + skip,
  // not parallel interleaving at the first await. True mid-await TOCTOU is
  // covered by tryClaimInFlight direct tests + recover-vs-live-claim below.

  it('serialized concurrent runNow → single session; other skip_previous_running', async () => {
    useAutomationStore.setState({
      automations: [auto({ id: 'auto_conc', prompt: 'go' })],
      loaded: true,
    })

    // Slow config so both can queue before first finishes body
    let resolveCfg!: (v: unknown) => void
    buildSessionConfigFromAutomation.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCfg = resolve
        }),
    )

    const p1 = useAutomationStore.getState().runNow('auto_conc', {
      trigger: 'schedule',
      focus: false,
      nowMs: 1000,
    })
    const p2 = useAutomationStore.getState().runNow('auto_conc', {
      trigger: 'manual',
      focus: true,
      nowMs: 1001,
    })

    // Let microtasks flush so first body starts and hits await
    await Promise.resolve()
    await Promise.resolve()
    // Mid-await: direct claim for same id still blocked (sync claim hold)
    expect(tryClaimInFlight('auto_conc', { trigger: 'manual' })).toEqual({
      ok: false,
      error: 'skip_previous_running',
    })
    resolveCfg!({ ok: true, config: okConfig })

    await Promise.all([p1, p2])

    expect(createSession).toHaveBeenCalledTimes(1)
    const skips = useAutomationStore
      .getState()
      .runs.filter((r) => r.status === 'skipped')
    expect(skips.some((r) => r.error === 'skip_previous_running')).toBe(true)
    // Winner still holds claim until completeRun
    expect(isInFlight('auto_conc')).toBe(true)
  })

  // ─── failBeforeSession releases claim ──────────────────────

  it('failBeforeSession releases claim so second runNow can claim', async () => {
    useAutomationStore.setState({
      automations: [auto({ id: 'auto_fail' })],
      loaded: true,
    })
    buildSessionConfigFromAutomation.mockResolvedValueOnce({
      ok: false,
      error: 'no_model_configured',
    })

    await useAutomationStore.getState().runNow('auto_fail', {
      trigger: 'manual',
      nowMs: 2000,
    })

    expect(isInFlight('auto_fail')).toBe(false)
    expect(createSession).not.toHaveBeenCalled()
    const failed = useAutomationStore
      .getState()
      .runs.find((r) => r.status === 'failed')
    expect(failed?.error).toBe('no_model_configured')

    // Second runNow can claim
    buildSessionConfigFromAutomation.mockResolvedValueOnce({
      ok: true,
      config: okConfig,
    })
    await useAutomationStore.getState().runNow('auto_fail', {
      trigger: 'manual',
      nowMs: 2001,
    })
    expect(createSession).toHaveBeenCalledTimes(1)
    expect(isInFlight('auto_fail')).toBe(true)
  })

  it('project_missing path also releases claim', async () => {
    useAutomationStore.setState({
      automations: [auto({ id: 'auto_pm', projectPath: '/gone' })],
      loaded: true,
    })
    buildSessionConfigFromAutomation.mockResolvedValueOnce({
      ok: false,
      error: 'project_missing',
    })
    await useAutomationStore.getState().runNow('auto_pm', {
      trigger: 'schedule',
      nowMs: 3000,
    })
    expect(isInFlight('auto_pm')).toBe(false)
    expect(
      useAutomationStore.getState().runs.some((r) => r.error === 'project_missing'),
    ).toBe(true)
  })

  // ─── runNow focus / rename / send ──────────────────────────

  it('runNow focus=false uses activate:false and does not selectSession', async () => {
    useAutomationStore.setState({
      automations: [auto({ id: 'auto_bg', name: 'BG', prompt: 'hi' })],
      loaded: true,
    })
    await useAutomationStore.getState().runNow('auto_bg', {
      trigger: 'schedule',
      focus: false,
      nowMs: 4000,
    })
    expect(createSession).toHaveBeenCalledWith(okConfig, { activate: false })
    expect(selectSession).not.toHaveBeenCalled()
    expect(renameSession).toHaveBeenCalledWith(
      expect.any(String),
      '⏱ BG',
    )
    expect(sendMessageToSession).toHaveBeenCalledWith(
      expect.any(String),
      'hi',
    )
    // rename before send (call order)
    const renameOrder = renameSession.mock.invocationCallOrder[0]
    const sendOrder = sendMessageToSession.mock.invocationCallOrder[0]
    expect(renameOrder).toBeLessThan(sendOrder)
  })

  it('runNow focus=true activates and selectSession', async () => {
    useAutomationStore.setState({
      automations: [auto({ id: 'auto_fg', name: 'FG', prompt: 'x' })],
      loaded: true,
    })
    await useAutomationStore.getState().runNow('auto_fg', {
      trigger: 'manual',
      focus: true,
      nowMs: 4001,
    })
    expect(createSession).toHaveBeenCalledWith(okConfig, { activate: true })
    expect(selectSession).toHaveBeenCalledWith(expect.any(String))
  })

  // ─── completeRun releases claim ────────────────────────────

  it('completeRun dual-file + releaseInFlight', async () => {
    useAutomationStore.setState({
      automations: [auto({ id: 'auto_done' })],
      runs: [
        run({
          id: 'arun_done',
          automationId: 'auto_done',
          status: 'running',
          sessionId: 's1',
          startedAt: 10,
        }),
      ],
      loaded: true,
    })
    tryClaimInFlight('auto_done', { trigger: 'manual' })
    useAutomationStore.getState().registerWatch('arun_done', 's1', 'auto_done')

    const order: string[] = []
    saveAutomationRuns.mockImplementation(async () => {
      order.push('runs')
    })
    saveAutomations.mockImplementation(async () => {
      order.push('catalog')
    })

    await useAutomationStore.getState().completeRun('arun_done', {
      status: 'succeeded',
      error: null,
      finishedAt: 99,
    })

    expect(order[0]).toBe('runs')
    expect(isInFlight('auto_done')).toBe(false)
    expect(getWatch('arun_done')).toBeUndefined()
    expect(useAutomationStore.getState().runs[0].status).toBe('succeeded')
    expect(useAutomationStore.getState().automations[0].lastStatus).toBe(
      'succeeded',
    )
  })

  // ─── recoverOrphanRuns ─────────────────────────────────────

  it('recoverOrphanRuns no-op when !sessionListReady', async () => {
    useAutomationStore.setState({
      sessionListReady: false,
      automations: [auto({ id: 'auto_or' })],
      runs: [
        run({
          id: 'arun_or',
          automationId: 'auto_or',
          status: 'running',
          sessionId: 'missing',
        }),
      ],
      loaded: true,
    })
    await useAutomationStore.getState().recoverOrphanRuns(5000)
    expect(useAutomationStore.getState().runs[0].status).toBe('running')
    expect(saveAutomationRuns).not.toHaveBeenCalled()
  })

  it('recover: missing session → failed / process_interrupted', async () => {
    useAutomationStore.setState({
      sessionListReady: true,
      automations: [auto({ id: 'auto_miss' })],
      runs: [
        run({
          id: 'arun_miss',
          automationId: 'auto_miss',
          status: 'running',
          sessionId: 'gone-sess',
          startedAt: 1,
        }),
      ],
      loaded: true,
    })
    // domainSessions empty → missing
    await useAutomationStore.getState().recoverOrphanRuns(6000)
    const r = useAutomationStore.getState().runs[0]
    expect(r.status).toBe('failed')
    expect(r.error).toBe('process_interrupted')
    expect(isInFlight('auto_miss')).toBe(false)
  })

  it('recover: loaded idle no HITL → succeeded', async () => {
    domainSessions.push({ id: 's-ok', status: 'idle', loaded: true })
    useAutomationStore.setState({
      sessionListReady: true,
      automations: [auto({ id: 'auto_ok' })],
      runs: [
        run({
          id: 'arun_ok',
          automationId: 'auto_ok',
          status: 'running',
          sessionId: 's-ok',
          startedAt: 1,
        }),
      ],
      loaded: true,
    })
    await useAutomationStore.getState().recoverOrphanRuns(7000)
    expect(useAutomationStore.getState().runs[0].status).toBe('succeeded')
    expect(useAutomationStore.getState().runs[0].error).toBeNull()
  })

  it('recover: unloaded idle list summary → process_interrupted (not succeeded)', async () => {
    // summaryToVM always sets status idle + loaded:false — not completion evidence
    domainSessions.push({ id: 's-sum', status: 'idle', loaded: false })
    useAutomationStore.setState({
      sessionListReady: true,
      automations: [auto({ id: 'auto_sum' })],
      runs: [
        run({
          id: 'arun_sum',
          automationId: 'auto_sum',
          status: 'running',
          sessionId: 's-sum',
          startedAt: 1,
        }),
      ],
      loaded: true,
    })
    await useAutomationStore.getState().recoverOrphanRuns(7100)
    const r = useAutomationStore.getState().runs[0]
    expect(r.status).toBe('failed')
    expect(r.error).toBe('process_interrupted')
  })

  it('recover: live claim + sessionId null → no-op (claim stays)', async () => {
    useAutomationStore.setState({
      sessionListReady: true,
      automations: [auto({ id: 'auto_live' })],
      runs: [
        run({
          id: 'arun_live',
          automationId: 'auto_live',
          status: 'running',
          sessionId: null,
          startedAt: 1,
        }),
      ],
      loaded: true,
    })
    tryClaimInFlight('auto_live', { trigger: 'manual' })
    await useAutomationStore.getState().recoverOrphanRuns(7200)
    expect(useAutomationStore.getState().runs[0].status).toBe('running')
    expect(useAutomationStore.getState().runs[0].sessionId).toBeNull()
    expect(isInFlight('auto_live')).toBe(true)
    expect(saveAutomationRuns).not.toHaveBeenCalled()
  })

  it('recover: live claim + sessionId present → ensure watch only, no complete', async () => {
    domainSessions.push({ id: 's-claimed', status: 'idle', loaded: true })
    useAutomationStore.setState({
      sessionListReady: true,
      automations: [auto({ id: 'auto_cl' })],
      runs: [
        run({
          id: 'arun_cl',
          automationId: 'auto_cl',
          status: 'running',
          sessionId: 's-claimed',
          startedAt: 1,
        }),
      ],
      loaded: true,
    })
    tryClaimInFlight('auto_cl', { trigger: 'manual' })
    await useAutomationStore.getState().recoverOrphanRuns(7300)
    expect(useAutomationStore.getState().runs[0].status).toBe('running')
    expect(isInFlight('auto_cl')).toBe(true)
    expect(getWatch('arun_cl')).toEqual({
      sessionId: 's-claimed',
      automationId: 'auto_cl',
    })
  })

  it('recover: live session error → failed + message', async () => {
    domainSessions.push({
      id: 's-err',
      status: 'error',
      loaded: true,
      error: { message: 'provider_down' },
    })
    useAutomationStore.setState({
      sessionListReady: true,
      automations: [auto({ id: 'auto_err' })],
      runs: [
        run({
          id: 'arun_err',
          automationId: 'auto_err',
          status: 'running',
          sessionId: 's-err',
          startedAt: 1,
        }),
      ],
      loaded: true,
    })
    await useAutomationStore.getState().recoverOrphanRuns(8000)
    const r = useAutomationStore.getState().runs[0]
    expect(r.status).toBe('failed')
    expect(r.error).toBe('provider_down')
  })

  it('recover: waiting_user + live HITL → re-attach claim + watch', async () => {
    domainSessions.push({
      id: 's-hitl',
      status: 'running',
      loaded: true,
      pendingPermission: { requestId: 'p1' },
    })
    useAutomationStore.setState({
      sessionListReady: true,
      automations: [auto({ id: 'auto_hitl' })],
      runs: [
        run({
          id: 'arun_hitl',
          automationId: 'auto_hitl',
          status: 'waiting_user',
          sessionId: 's-hitl',
          startedAt: 1,
        }),
      ],
      loaded: true,
    })
    await useAutomationStore.getState().recoverOrphanRuns(9000)
    expect(isInFlight('auto_hitl')).toBe(true)
    expect(getWatch('arun_hitl')).toEqual({
      sessionId: 's-hitl',
      automationId: 'auto_hitl',
    })
    // Still open — not completed
    expect(useAutomationStore.getState().runs[0].status).toBe('waiting_user')
  })

  it('recover: in_flight live session → re-claim + watch (no complete)', async () => {
    domainSessions.push({ id: 's-run', status: 'running', loaded: true })
    useAutomationStore.setState({
      sessionListReady: true,
      automations: [auto({ id: 'auto_run' })],
      runs: [
        run({
          id: 'arun_run',
          automationId: 'auto_run',
          status: 'running',
          sessionId: 's-run',
          startedAt: 1,
        }),
      ],
      loaded: true,
    })
    await useAutomationStore.getState().recoverOrphanRuns(9100)
    expect(isInFlight('auto_run')).toBe(true)
    expect(getWatch('arun_run')?.sessionId).toBe('s-run')
    expect(useAutomationStore.getState().runs[0].status).toBe('running')
  })

  it('markSessionListReady flips flag so recover can run', async () => {
    useAutomationStore.setState({
      sessionListReady: false,
      automations: [auto({ id: 'auto_ready' })],
      runs: [
        run({
          id: 'arun_ready',
          automationId: 'auto_ready',
          status: 'running',
          sessionId: null,
        }),
      ],
      loaded: true,
    })
    await useAutomationStore.getState().recoverOrphanRuns()
    expect(useAutomationStore.getState().runs[0].status).toBe('running')

    useAutomationStore.getState().markSessionListReady()
    expect(useAutomationStore.getState().sessionListReady).toBe(true)
    await useAutomationStore.getState().recoverOrphanRuns(9200)
    expect(useAutomationStore.getState().runs[0].status).toBe('failed')
    expect(useAutomationStore.getState().runs[0].error).toBe(
      'process_interrupted',
    )
  })

  // ─── release on IPC failure (finally) ──────────────────────

  it('completeRun releases claim when saveRuns rejects', async () => {
    useAutomationStore.setState({
      automations: [auto({ id: 'auto_ipc' })],
      runs: [
        run({
          id: 'arun_ipc',
          automationId: 'auto_ipc',
          status: 'running',
          sessionId: 's1',
          startedAt: 10,
        }),
      ],
      loaded: true,
    })
    tryClaimInFlight('auto_ipc', { trigger: 'manual' })
    saveAutomationRuns.mockRejectedValueOnce(new Error('disk full'))

    await expect(
      useAutomationStore.getState().completeRun('arun_ipc', {
        status: 'succeeded',
        error: null,
        finishedAt: 99,
      }),
    ).rejects.toThrow()

    expect(isInFlight('auto_ipc')).toBe(false)
  })

  it('failBeforeSession releases claim when saveRuns rejects', async () => {
    useAutomationStore.setState({
      automations: [auto({ id: 'auto_fb' })],
      loaded: true,
    })
    tryClaimInFlight('auto_fb', { trigger: 'manual' })
    saveAutomationRuns.mockRejectedValueOnce(new Error('disk full'))

    await expect(
      useAutomationStore.getState().failBeforeSession('auto_fb', {
        trigger: 'manual',
        error: 'no_model_configured',
        now: 1,
      }),
    ).rejects.toThrow()

    expect(isInFlight('auto_fb')).toBe(false)
  })

  it('failBeforeSession rolls nextRunAt for schedule trigger', async () => {
    const nextRunAt = Date.now() - 1000
    useAutomationStore.setState({
      automations: [
        auto({
          id: 'auto_roll',
          trigger: { kind: 'daily', hour: 9, minute: 0 },
          nextRunAt,
        }),
      ],
      loaded: true,
    })
    tryClaimInFlight('auto_roll', { trigger: 'schedule' })
    await useAutomationStore.getState().failBeforeSession('auto_roll', {
      trigger: 'schedule',
      error: 'project_missing',
      now: Date.now(),
    })
    const a = useAutomationStore.getState().automations[0]
    expect(a.nextRunAt).not.toBe(nextRunAt)
    expect(a.nextRunAt).toEqual(expect.any(Number))
    expect(isInFlight('auto_roll')).toBe(false)
  })

  // ─── delete vs runNow race ─────────────────────────────────

  it('runNow aborts after delete during config build (no session)', async () => {
    useAutomationStore.setState({
      automations: [auto({ id: 'auto_del', prompt: 'x' })],
      loaded: true,
    })
    let resolveCfg!: (v: unknown) => void
    buildSessionConfigFromAutomation.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCfg = resolve
        }),
    )

    const p = useAutomationStore.getState().runNow('auto_del', {
      trigger: 'manual',
      nowMs: 1,
    })
    await Promise.resolve()
    await Promise.resolve()
    // Catalog drop while body still holds claim (delete race mid-await)
    useAutomationStore.setState({ automations: [] })

    resolveCfg!({ ok: true, config: okConfig })
    await p

    expect(createSession).not.toHaveBeenCalled()
    expect(isInFlight('auto_del')).toBe(false)
  })

  // ─── patchRunStatus does not release ───────────────────────

  it('patchRunStatus waiting_user does not release claim', async () => {
    useAutomationStore.setState({
      automations: [auto({ id: 'auto_w' })],
      runs: [
        run({
          id: 'arun_w',
          automationId: 'auto_w',
          status: 'running',
          sessionId: 's1',
        }),
      ],
      loaded: true,
    })
    tryClaimInFlight('auto_w', { trigger: 'manual' })
    await useAutomationStore.getState().patchRunStatus('arun_w', 'waiting_user')
    expect(isInFlight('auto_w')).toBe(true)
    expect(useAutomationStore.getState().runs[0].status).toBe('waiting_user')
  })
})
