import { describe, expect, it } from 'vitest'
import {
  classifySessionForAutomation,
  formatAutomationSessionTitle,
  GLOBAL_RUNS_MAX,
  PER_AUTO_RUNS_MAX,
  truncateRuns,
} from './runLifecycle'
import type { AutomationRun, AutomationSessionSnapshot } from './types'

function snap(
  partial: Partial<AutomationSessionSnapshot> & {
    status: AutomationSessionSnapshot['status']
  },
): AutomationSessionSnapshot {
  return partial
}

describe('classifySessionForAutomation', () => {
  it('missing session → failed', () => {
    expect(classifySessionForAutomation(undefined)).toBe('failed')
    expect(classifySessionForAutomation(null)).toBe('failed')
  })

  it('status error → failed (even with no HITL)', () => {
    expect(classifySessionForAutomation(snap({ status: 'error' }))).toBe(
      'failed',
    )
  })

  it('running + pendingPermission → waiting_user (HITL before status)', () => {
    // ACP permission:request keeps status running — must not be in_flight
    expect(
      classifySessionForAutomation(
        snap({
          status: 'running',
          pendingPermission: { requestId: 'r1' },
        }),
      ),
    ).toBe('waiting_user')
  })

  it('idle + interrupt → waiting_user', () => {
    expect(
      classifySessionForAutomation(
        snap({
          status: 'idle',
          interrupt: { turnId: 't1', question: 'ok?' },
        }),
      ),
    ).toBe('waiting_user')
  })

  it('running + interrupt → waiting_user (HITL before status)', () => {
    // interrupt can leave status idle *or* still running depending on agent path
    expect(
      classifySessionForAutomation(
        snap({
          status: 'running',
          interrupt: { turnId: 't2', question: 'continue?' },
        }),
      ),
    ).toBe('waiting_user')
  })

  it('idle + planApprovalPending → waiting_user', () => {
    expect(
      classifySessionForAutomation(
        snap({ status: 'idle', planApprovalPending: true }),
      ),
    ).toBe('waiting_user')
  })

  it('running + planApprovalPending → waiting_user', () => {
    expect(
      classifySessionForAutomation(
        snap({ status: 'running', planApprovalPending: true }),
      ),
    ).toBe('waiting_user')
  })

  it('error + HITL still failed (error checked first)', () => {
    expect(
      classifySessionForAutomation(
        snap({
          status: 'error',
          pendingPermission: { requestId: 'x' },
        }),
      ),
    ).toBe('failed')
  })

  it('running without HITL → in_flight', () => {
    expect(
      classifySessionForAutomation(
        snap({
          status: 'running',
          pendingPermission: null,
          interrupt: null,
          planApprovalPending: false,
        }),
      ),
    ).toBe('in_flight')
  })

  it('idle without HITL → succeeded', () => {
    expect(
      classifySessionForAutomation(
        snap({
          status: 'idle',
          pendingPermission: null,
          interrupt: null,
          planApprovalPending: false,
        }),
      ),
    ).toBe('succeeded')
  })

  it('truthy checks: empty object pendingPermission still waiting_user', () => {
    expect(
      classifySessionForAutomation(
        snap({ status: 'running', pendingPermission: {} }),
      ),
    ).toBe('waiting_user')
  })

  it('falsy HITL fields do not force waiting_user', () => {
    expect(
      classifySessionForAutomation(
        snap({
          status: 'running',
          pendingPermission: null,
          interrupt: undefined,
          planApprovalPending: false,
        }),
      ),
    ).toBe('in_flight')
  })
})

describe('truncateRuns', () => {
  function mk(
    automationId: string,
    startedAt: number,
    id?: string,
  ): AutomationRun {
    return {
      id: id ?? `arun_${automationId}_${startedAt}`,
      automationId,
      status: 'succeeded',
      trigger: 'manual',
      startedAt,
    }
  }

  it('empty → empty', () => {
    expect(truncateRuns([])).toEqual([])
  })

  it('per-auto keeps newest PER_AUTO_RUNS_MAX', () => {
    const runs: AutomationRun[] = []
    for (let i = 0; i < PER_AUTO_RUNS_MAX + 10; i++) {
      runs.push(mk('auto_a', i + 1, `arun_a_${i}`))
    }
    const out = truncateRuns(runs)
    expect(out).toHaveLength(PER_AUTO_RUNS_MAX)
    expect(out.every((r) => r.automationId === 'auto_a')).toBe(true)
    // Newest first overall
    expect(out[0]!.startedAt).toBe(PER_AUTO_RUNS_MAX + 10)
    const times = out.map((r) => r.startedAt)
    expect(Math.min(...times)).toBe(11) // dropped 1..10
  })

  it('applies per-auto then global (two filters, not OR)', () => {
    // 3 autos × 40 = 120 < 500 — all kept after per-auto
    const runs: AutomationRun[] = []
    for (const id of ['auto_1', 'auto_2', 'auto_3']) {
      for (let i = 0; i < 40; i++) {
        runs.push(mk(id, i + 1, `arun_${id}_${i}`))
      }
    }
    expect(truncateRuns(runs)).toHaveLength(120)

    // One auto with 60 → trimmed to 50; others untouched
    const heavy: AutomationRun[] = []
    for (let i = 0; i < 60; i++) {
      heavy.push(mk('auto_heavy', 1000 + i, `arun_h_${i}`))
    }
    for (let i = 0; i < 10; i++) {
      heavy.push(mk('auto_light', i + 1, `arun_l_${i}`))
    }
    const out = truncateRuns(heavy)
    expect(out.filter((r) => r.automationId === 'auto_heavy')).toHaveLength(
      PER_AUTO_RUNS_MAX,
    )
    expect(out.filter((r) => r.automationId === 'auto_light')).toHaveLength(10)
    expect(out).toHaveLength(PER_AUTO_RUNS_MAX + 10)
  })

  it('global cap keeps newest GLOBAL_RUNS_MAX after per-auto', () => {
    // 20 autos × 50 = 1000 → global slices to 500 newest
    const runs: AutomationRun[] = []
    for (let a = 0; a < 20; a++) {
      for (let i = 0; i < PER_AUTO_RUNS_MAX; i++) {
        // startedAt unique and increasing with (a,i)
        const t = a * 1000 + i
        runs.push(mk(`auto_${a}`, t, `arun_${a}_${i}`))
      }
    }
    expect(runs).toHaveLength(20 * PER_AUTO_RUNS_MAX)
    const out = truncateRuns(runs)
    expect(out).toHaveLength(GLOBAL_RUNS_MAX)
    // Newest overall first
    expect(out[0]!.startedAt).toBeGreaterThan(out[out.length - 1]!.startedAt)
    const maxT = Math.max(...runs.map((r) => r.startedAt))
    expect(out[0]!.startedAt).toBe(maxT)
  })

  it('exports match design caps', () => {
    expect(PER_AUTO_RUNS_MAX).toBe(50)
    expect(GLOBAL_RUNS_MAX).toBe(500)
  })
})

describe('formatAutomationSessionTitle', () => {
  it('prefixes name with ⏱', () => {
    expect(formatAutomationSessionTitle('Daily standup')).toBe(
      '⏱ Daily standup',
    )
  })

  it('falls back when name blank', () => {
    expect(formatAutomationSessionTitle('   ')).toBe('⏱ Automation')
  })
})
