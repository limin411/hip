import { describe, expect, it } from 'vitest'
import { assertPrimaryNotInSlotPaths, planParallelFanout } from './parallelFanout'

describe('parallelFanout (P5)', () => {
  it('clamps N to 1–4 and builds unique branches', () => {
    const p = planParallelFanout({ n: 3, prompt: 'try both', runId: 'x' })
    expect(p.n).toBe(3)
    expect(p.slots).toHaveLength(3)
    expect(new Set(p.slots.map((s) => s.branch)).size).toBe(3)
    expect(planParallelFanout({ n: 99, prompt: 'p', runId: 'y' }).n).toBe(4)
    expect(planParallelFanout({ n: 1, prompt: 'p', runId: 'z' }).n).toBe(1)
    expect(planParallelFanout({ n: 1, prompt: 'p', runId: 'z' }).slots).toHaveLength(1)
  })

  it('detects primary path collision', () => {
    expect(assertPrimaryNotInSlotPaths('/repo', ['/repo/wt-a', '/repo/wt-b'])).toEqual({ ok: true })
    expect(assertPrimaryNotInSlotPaths('/repo', ['/repo'])).toMatchObject({ ok: false })
  })
})
