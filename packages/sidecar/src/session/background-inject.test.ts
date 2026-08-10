// packages/sidecar/src/session/background-inject.test.ts
import { describe, it, expect } from 'vitest'
import { backgroundStatusText, PendingBackgroundResults } from './background-inject.js'

function fakeBg(metas: Array<{ id: string; description: string; status: string; kind?: string; createdAt?: number }>) {
  const meta = new Map<string, { status: string; description: string; kind?: string; createdAt?: number }>()
  for (const m of metas) meta.set(m.id, m)
  return {
    meta,
  } as unknown as import('./task-runtime.js').BackgroundManager
}

describe('backgroundStatusText', () => {
  it('returns null when nothing is running', () => {
    const bg = fakeBg([
      { id: 't1', description: 'done task', status: 'completed', createdAt: Date.now() - 1000 },
    ])
    expect(backgroundStatusText(bg)).toBeNull()
  })

  it('returns null for undefined manager', () => {
    expect(backgroundStatusText(undefined)).toBeNull()
  })

  it('lists running tasks with description and age', () => {
    const now = Date.now()
    const bg = fakeBg([
      { id: 't1', description: 'build docs', status: 'running', kind: 'agent', createdAt: now - 3 * 60000 },
      { id: 't2', description: 'run tests', status: 'running', kind: 'shell', createdAt: now - 30 * 60000 },
      { id: 't3', description: 'finished', status: 'completed', createdAt: now },
    ])
    const text = backgroundStatusText(bg)
    expect(text).not.toBeNull()
    expect(text!).toContain('t1')
    expect(text!).toContain('build docs')
    expect(text!).toContain('started 3 min ago')
    expect(text!).toContain('t2')
    expect(text!).toContain('started 30 min ago')
    expect(text!).not.toContain('t3')
    expect(text!).toContain('wait_tasks')
  })

  it('excludes schedule-kind tasks', () => {
    const bg = fakeBg([
      { id: 's1', description: 'cron', status: 'running', kind: 'schedule', createdAt: Date.now() },
    ])
    expect(backgroundStatusText(bg)).toBeNull()
  })
})

describe('PendingBackgroundResults', () => {
  it('collects completed results and drains once', () => {
    const p = new PendingBackgroundResults()
    p.collect('t1', 'completed', 'all tests pass')
    p.collect('t2', 'failed', 'compile error')
    expect(p.size).toBe(2)
    const text = p.drain()
    expect(text).not.toBeNull()
    expect(text!).toContain('t1')
    expect(text!).toContain('all tests pass')
    expect(text!).toContain('t2')
    expect(text!).toContain('compile error')
    // drained — second drain is empty
    expect(p.drain()).toBeNull()
  })

  it('ignores running/killed statuses', () => {
    const p = new PendingBackgroundResults()
    p.collect('t1', 'running', 'still going')
    p.collect('t2', 'killed', 'nope')
    expect(p.size).toBe(0)
    expect(p.drain()).toBeNull()
  })

  it('caps result body length', () => {
    const p = new PendingBackgroundResults()
    p.collect('t1', 'completed', 'x'.repeat(5000))
    const text = p.drain()!
    expect(text.length).toBeLessThan(2500)
  })

  it('substitutes empty output', () => {
    const p = new PendingBackgroundResults()
    p.collect('t1', 'completed', '   ')
    expect(p.drain()).toContain('(no output)')
  })
})
