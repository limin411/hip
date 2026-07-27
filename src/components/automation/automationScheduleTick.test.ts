// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Automation, AutomationRun } from '@/domain/automations'
import { MISS_WINDOW_MS, DUE_SLACK_MS } from '@/domain/automations'

const runNow = vi.fn().mockResolvedValue(undefined)
const recordSkip = vi.fn().mockResolvedValue(undefined)
const patchNextRunAt = vi.fn().mockResolvedValue(undefined)
const completeRun = vi.fn().mockResolvedValue(undefined)
const patchRunStatus = vi.fn().mockResolvedValue(undefined)

let automations: Automation[] = []
let runs: AutomationRun[] = []
let watches: Array<{ runId: string; sessionId: string; automationId: string }> =
  []
let sessions: Array<{
  id: string
  status: 'idle' | 'running' | 'error'
  loaded?: boolean
  pendingPermission?: unknown
  interrupt?: unknown
  planApprovalPending?: boolean
  error?: { message?: string; code?: string } | null
}> = []

vi.mock('@/store/automationStore', () => {
  const getState = () => ({
    automations,
    runs,
    runNow,
    recordSkip,
    patchNextRunAt,
    completeRun,
    patchRunStatus,
  })
  return {
    useAutomationStore: { getState },
    listWatches: () => watches,
  }
})

vi.mock('@/domain/sessionStore', () => ({
  useDomainStore: {
    getState: () => ({ sessions }),
  },
}))

import {
  runAutomationOnTick,
  sampleAutomationWatches,
  automationHostTick,
} from './automationScheduleTick'

function daily(
  partial: Partial<Automation> & { id: string; nextRunAt?: number | null },
): Automation {
  return {
    name: 'Daily',
    prompt: 'go',
    enabled: true,
    trigger: { kind: 'daily', hour: 10, minute: 0 },
    createdAt: 1,
    updatedAt: 1,
    nextRunAt: null,
    ...partial,
  }
}

describe('runAutomationOnTick', () => {
  beforeEach(() => {
    automations = []
    runs = []
    watches = []
    sessions = []
    runNow.mockClear()
    recordSkip.mockClear()
    patchNextRunAt.mockClear()
    completeRun.mockClear()
    patchRunStatus.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('seeds nextRunAt when null and does not fire', () => {
    const now = Date.UTC(2026, 6, 27, 2, 0) // arbitrary
    automations = [daily({ id: 'auto_seed', nextRunAt: null })]
    runAutomationOnTick(now)
    expect(patchNextRunAt).toHaveBeenCalledWith(
      'auto_seed',
      expect.any(Number),
    )
    expect(runNow).not.toHaveBeenCalled()
    expect(recordSkip).not.toHaveBeenCalled()
  })

  it('skips manual and disabled automations', () => {
    const now = 1_000_000
    automations = [
      daily({
        id: 'auto_manual',
        trigger: { kind: 'manual' },
        nextRunAt: now - 1,
      }),
      daily({ id: 'auto_off', enabled: false, nextRunAt: now - 1 }),
    ]
    runAutomationOnTick(now)
    expect(runNow).not.toHaveBeenCalled()
    expect(recordSkip).not.toHaveBeenCalled()
  })

  it('fires schedule with focus:false when lag ≤ 30s', () => {
    const next = 1_000_000
    const now = next + DUE_SLACK_MS
    automations = [daily({ id: 'auto_due', nextRunAt: next })]
    runAutomationOnTick(now)
    expect(runNow).toHaveBeenCalledWith('auto_due', {
      focus: false,
      trigger: 'schedule',
      nowMs: now,
    })
  })

  it('fires catchup when lag > 30s and < 6h', () => {
    const next = 1_000_000
    const now = next + DUE_SLACK_MS + 1
    automations = [daily({ id: 'auto_cu', nextRunAt: next })]
    runAutomationOnTick(now)
    expect(runNow).toHaveBeenCalledWith('auto_cu', {
      focus: false,
      trigger: 'catchup',
      nowMs: now,
    })
  })

  it('skip_miss mid-session uses missed_over_6h', () => {
    const next = 1_000_000
    const now = next + MISS_WINDOW_MS
    automations = [daily({ id: 'auto_miss', nextRunAt: next })]
    runAutomationOnTick(now, { coldStart: false })
    expect(runNow).not.toHaveBeenCalled()
    expect(recordSkip).toHaveBeenCalledWith('auto_miss', {
      trigger: 'catchup',
      error: 'missed_over_6h',
      now,
      rollNextRunAt: true,
    })
  })

  it('skip_miss coldStart uses app_was_quit', () => {
    const next = 1_000_000
    const now = next + MISS_WINDOW_MS + 5_000
    automations = [daily({ id: 'auto_quit', nextRunAt: next })]
    runAutomationOnTick(now, { coldStart: true })
    expect(recordSkip).toHaveBeenCalledWith('auto_quit', {
      trigger: 'catchup',
      error: 'app_was_quit',
      now,
      rollNextRunAt: true,
    })
  })

  it('noop when nextRunAt is in the future', () => {
    const next = 2_000_000
    automations = [daily({ id: 'auto_future', nextRunAt: next })]
    runAutomationOnTick(1_000_000)
    expect(runNow).not.toHaveBeenCalled()
    expect(recordSkip).not.toHaveBeenCalled()
  })
})

describe('sampleAutomationWatches', () => {
  beforeEach(() => {
    automations = []
    runs = []
    watches = []
    sessions = []
    completeRun.mockClear()
    patchRunStatus.mockClear()
  })

  it('completes succeeded when session idle without HITL', () => {
    watches = [{ runId: 'arun_1', sessionId: 's1', automationId: 'a1' }]
    sessions = [{ id: 's1', status: 'idle' }]
    sampleAutomationWatches(5000)
    expect(completeRun).toHaveBeenCalledWith('arun_1', {
      status: 'succeeded',
      error: null,
      finishedAt: 5000,
    })
  })

  it('patches waiting_user on HITL without completing', () => {
    watches = [{ runId: 'arun_2', sessionId: 's2', automationId: 'a2' }]
    runs = [
      {
        id: 'arun_2',
        automationId: 'a2',
        status: 'running',
        trigger: 'schedule',
        startedAt: 1,
      },
    ]
    sessions = [
      {
        id: 's2',
        status: 'running',
        pendingPermission: { id: 'p1' },
      },
    ]
    sampleAutomationWatches(6000)
    expect(patchRunStatus).toHaveBeenCalledWith('arun_2', 'waiting_user')
    expect(completeRun).not.toHaveBeenCalled()
  })

  it('leaves in_flight alone', () => {
    watches = [{ runId: 'arun_3', sessionId: 's3', automationId: 'a3' }]
    sessions = [{ id: 's3', status: 'running' }]
    sampleAutomationWatches(7000)
    expect(completeRun).not.toHaveBeenCalled()
    expect(patchRunStatus).not.toHaveBeenCalled()
  })

  it('skips unloaded list summaries (no false success)', () => {
    watches = [{ runId: 'arun_4', sessionId: 's4', automationId: 'a4' }]
    sessions = [{ id: 's4', status: 'idle', loaded: false }]
    sampleAutomationWatches(8000)
    expect(completeRun).not.toHaveBeenCalled()
    expect(patchRunStatus).not.toHaveBeenCalled()
  })
})

describe('automationHostTick', () => {
  beforeEach(() => {
    automations = []
    runs = []
    watches = []
    sessions = []
    runNow.mockClear()
    completeRun.mockClear()
  })

  it('samples watches then evaluates schedules', () => {
    const next = 1_000_000
    const now = next
    watches = [{ runId: 'arun_x', sessionId: 'sx', automationId: 'ax' }]
    sessions = [{ id: 'sx', status: 'idle' }]
    automations = [daily({ id: 'auto_h', nextRunAt: next })]
    automationHostTick(now)
    expect(completeRun).toHaveBeenCalled()
    expect(runNow).toHaveBeenCalledWith('auto_h', {
      focus: false,
      trigger: 'schedule',
      nowMs: now,
    })
  })
})
