import { describe, it, expect } from 'vitest'
import { aggregateHero, buildZoneModels } from './zoneProgress'
import type { WorkbenchSnapshot } from './workbenchTypes'

function baseSnap(over: Partial<WorkbenchSnapshot> = {}): WorkbenchSnapshot {
  return {
    nowMs: 1_000_000,
    flags: {
      workItems: true,
      automations: true,
      terminals: true,
      workflows: false,
    },
    sessions: { runningCount: 0, activeWorkTotal: 0 },
    tasks: {
      todo: 0,
      inProgress: 0,
      done: 0,
      cancelled: 0,
      latestCompletedAt: null,
    },
    automations: {
      enabled: 0,
      inFlight: 0,
      failedLast: 0,
      waitingUser: 0,
    },
    knowledge: { spaceCount: 0 },
    terminals: { activeCount: 0, runningShells: 0 },
    ...over,
  }
}

describe('buildZoneModels', () => {
  it('always includes sessions and knowledge', () => {
    const zones = buildZoneModels(
      baseSnap({
        flags: {
          workItems: false,
          automations: false,
          terminals: false,
          workflows: false,
        },
      }),
    )
    expect(zones.map((z) => z.id)).toEqual(['sessions', 'knowledge'])
  })

  it('filters by feature flags', () => {
    const zones = buildZoneModels(baseSnap())
    expect(zones.map((z) => z.id)).toEqual([
      'sessions',
      'tasks',
      'automations',
      'knowledge',
      'terminals',
    ])
  })

  it('marks sessions running when runningCount > 0', () => {
    const zones = buildZoneModels(
      baseSnap({ sessions: { runningCount: 2, activeWorkTotal: 5 } }),
    )
    const s = zones.find((z) => z.id === 'sessions')!
    expect(s.state).toBe('running')
    expect(s.primaryMetricKey).toBe('workbench.metric.sessionsRunning')
    expect(s.primaryMetricValues).toEqual({ count: 2 })
    expect(s.progress).toBeNull()
  })

  it('computes tasks progress excluding cancelled', () => {
    const zones = buildZoneModels(
      baseSnap({
        tasks: {
          todo: 2,
          inProgress: 1,
          done: 3,
          cancelled: 9,
          latestCompletedAt: null,
        },
      }),
    )
    const t = zones.find((z) => z.id === 'tasks')!
    expect(t.state).toBe('running')
    expect(t.progress).toBeCloseTo(3 / 6)
    expect(t.primaryMetricValues).toEqual({ done: 3, total: 6 })
  })

  it('marks tasks done only inside done window', () => {
    const now = 1_000_000
    const recent = buildZoneModels(
      baseSnap({
        nowMs: now,
        tasks: {
          todo: 0,
          inProgress: 0,
          done: 4,
          cancelled: 0,
          latestCompletedAt: now - 60_000,
        },
      }),
    ).find((z) => z.id === 'tasks')!
    expect(recent.state).toBe('done')

    const stale = buildZoneModels(
      baseSnap({
        nowMs: now,
        tasks: {
          todo: 0,
          inProgress: 0,
          done: 4,
          cancelled: 0,
          latestCompletedAt: now - 20 * 60_000,
        },
      }),
    ).find((z) => z.id === 'tasks')!
    expect(stale.state).toBe('idle')
  })

  it('prioritizes automation fail over running', () => {
    const z = buildZoneModels(
      baseSnap({
        automations: {
          enabled: 2,
          inFlight: 1,
          failedLast: 1,
          waitingUser: 0,
        },
      }),
    ).find((x) => x.id === 'automations')!
    expect(z.state).toBe('fail')
  })

  it('marks automation waiting_user as blocked', () => {
    const z = buildZoneModels(
      baseSnap({
        automations: {
          enabled: 1,
          inFlight: 0,
          failedLast: 0,
          waitingUser: 1,
        },
      }),
    ).find((x) => x.id === 'automations')!
    expect(z.state).toBe('blocked')
  })
})

describe('aggregateHero', () => {
  it('aggregates priority fail > blocked > running > done > idle', () => {
    const zones = buildZoneModels(
      baseSnap({
        sessions: { runningCount: 1, activeWorkTotal: 1 },
        automations: {
          enabled: 1,
          inFlight: 0,
          failedLast: 1,
          waitingUser: 0,
        },
      }),
    )
    const hero = aggregateHero(zones)
    expect(hero.state).toBe('fail')
    expect(hero.attentionCount).toBe(1)
    expect(hero.runningCount).toBe(1)
    expect(hero.titleKey).toBe('workbench.hero.titleAttention')
  })

  it('all idle → idle hero', () => {
    const hero = aggregateHero(buildZoneModels(baseSnap()))
    expect(hero.state).toBe('idle')
    expect(hero.titleKey).toBe('workbench.hero.titleIdle')
  })
})
