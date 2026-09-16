import { describe, expect, it } from 'vitest'
import { automationTriggerLabel } from './triggerLabel'
import type { AutomationTrigger } from './types'

/** Records the key + interpolation args so assertions do not depend on copy. */
function recorder() {
  const calls: Array<{ key: string; opts?: Record<string, unknown> }> = []
  const t = (key: string, opts?: Record<string, unknown>) => {
    calls.push({ key, opts })
    return opts ? `${key}:${JSON.stringify(opts)}` : key
  }
  return { t, calls }
}

describe('automationTriggerLabel', () => {
  it('labels a manual trigger', () => {
    const { t, calls } = recorder()
    automationTriggerLabel({ kind: 'manual' }, t)
    expect(calls[0]?.key).toBe('automation.trigger.manual')
  })

  it('labels a daily trigger with zero-padded time', () => {
    const { t, calls } = recorder()
    automationTriggerLabel({ kind: 'daily', hour: 9, minute: 5 }, t)
    expect(calls[0]).toEqual({
      key: 'automation.trigger.dailyAt',
      opts: { time: '09:05' },
    })
  })

  it('labels a weekly trigger with the weekday key', () => {
    const { t, calls } = recorder()
    automationTriggerLabel({ kind: 'weekly', weekday: 1, hour: 18, minute: 30 }, t)
    const call = calls.find((c) => c.key === 'automation.trigger.weeklyAt')
    expect(call?.opts).toEqual({ weekday: 'automation.weekday.1', time: '18:30' })
  })

  it('wraps out-of-range weekdays via modulo', () => {
    const { t, calls } = recorder()
    automationTriggerLabel({ kind: 'weekly', weekday: -1, hour: 8, minute: 0 }, t)
    const call = calls.find((c) => c.key === 'automation.trigger.weeklyAt')
    expect(call?.opts).toEqual({ weekday: 'automation.weekday.6', time: '08:00' })
  })

  it('labels an interval trigger in minutes without touching hour/minute', () => {
    const { t, calls } = recorder()
    automationTriggerLabel({ kind: 'interval', intervalMinutes: 30 }, t)
    // Regression: interval has no hour/minute — the shared "time" branch used to
    // render `undefined:undefined` for it.
    expect(calls[0]).toEqual({
      key: 'automation.trigger.intervalAt',
      opts: { minutes: 30 },
    })
  })

  it('labels whole-hour intervals in hours', () => {
    const { t, calls } = recorder()
    automationTriggerLabel({ kind: 'interval', intervalMinutes: 120 }, t)
    expect(calls[0]).toEqual({
      key: 'automation.trigger.intervalHoursAt',
      opts: { hours: 2 },
    })
  })

  it('keeps non-whole-hour intervals in minutes', () => {
    const { t, calls } = recorder()
    automationTriggerLabel({ kind: 'interval', intervalMinutes: 90 }, t)
    expect(calls[0]?.key).toBe('automation.trigger.intervalAt')
  })

  it('never emits "undefined" for any trigger kind', () => {
    const triggers: AutomationTrigger[] = [
      { kind: 'manual' },
      { kind: 'interval', intervalMinutes: 30 },
      { kind: 'daily', hour: 0, minute: 0 },
      { kind: 'weekly', weekday: 3, hour: 23, minute: 59 },
    ]
    for (const tr of triggers) {
      const { t } = recorder()
      expect(automationTriggerLabel(tr, t)).not.toContain('undefined')
    }
  })
})
