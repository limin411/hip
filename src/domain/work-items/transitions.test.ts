import { describe, expect, it } from 'vitest'
import { applyStatus, canTransition } from './transitions'
import type { WorkItem, WorkItemStatus } from './types'

function item(partial: Partial<WorkItem> & Pick<WorkItem, 'status'>): WorkItem {
  return {
    id: 'wi_test',
    title: 'T',
    priority: 'none',
    listId: 'wl_inbox',
    tags: [],
    notes: '',
    startOn: null,
    endOn: null,
    createdAt: 1,
    updatedAt: 1,
    completedAt: null,
    archivedAt: null,
    links: {},
    ...partial,
  }
}

const ALL: WorkItemStatus[] = ['todo', 'in_progress', 'done', 'cancelled']

describe('canTransition', () => {
  it('rejects same-status transitions', () => {
    for (const s of ALL) {
      expect(canTransition(s, s)).toBe(false)
    }
  })

  it('allows full matrix except self', () => {
    // todo → in_progress, done, cancelled
    expect(canTransition('todo', 'in_progress')).toBe(true)
    expect(canTransition('todo', 'done')).toBe(true)
    expect(canTransition('todo', 'cancelled')).toBe(true)

    // in_progress → todo, done, cancelled
    expect(canTransition('in_progress', 'todo')).toBe(true)
    expect(canTransition('in_progress', 'done')).toBe(true)
    expect(canTransition('in_progress', 'cancelled')).toBe(true)

    // done → todo, in_progress, cancelled
    expect(canTransition('done', 'todo')).toBe(true)
    expect(canTransition('done', 'in_progress')).toBe(true)
    expect(canTransition('done', 'cancelled')).toBe(true)

    // cancelled → todo, in_progress, done
    expect(canTransition('cancelled', 'todo')).toBe(true)
    expect(canTransition('cancelled', 'in_progress')).toBe(true)
    expect(canTransition('cancelled', 'done')).toBe(true)
  })
})

describe('applyStatus', () => {
  const now = 1_700_000_000_000

  it('sets completedAt when entering done', () => {
    const next = applyStatus(item({ status: 'todo', completedAt: null }), 'done', now)
    expect(next.status).toBe('done')
    expect(next.completedAt).toBe(now)
    expect(next.updatedAt).toBe(now)
  })

  it('sets completedAt when entering cancelled', () => {
    const next = applyStatus(
      item({ status: 'in_progress', completedAt: null }),
      'cancelled',
      now,
    )
    expect(next.status).toBe('cancelled')
    expect(next.completedAt).toBe(now)
  })

  it('clears completedAt when reopening from done to todo', () => {
    const next = applyStatus(
      item({ status: 'done', completedAt: 99 }),
      'todo',
      now,
    )
    expect(next.status).toBe('todo')
    expect(next.completedAt).toBeNull()
  })

  it('clears completedAt when reopening from cancelled to in_progress', () => {
    const next = applyStatus(
      item({ status: 'cancelled', completedAt: 99 }),
      'in_progress',
      now,
    )
    expect(next.status).toBe('in_progress')
    expect(next.completedAt).toBeNull()
  })

  it('refreshes completedAt when moving done → cancelled', () => {
    const next = applyStatus(
      item({ status: 'done', completedAt: 50 }),
      'cancelled',
      now,
    )
    expect(next.status).toBe('cancelled')
    expect(next.completedAt).toBe(now)
  })

  it('leaves open→open without completedAt', () => {
    const next = applyStatus(
      item({ status: 'todo', completedAt: null }),
      'in_progress',
      now,
    )
    expect(next.status).toBe('in_progress')
    expect(next.completedAt).toBeNull()
  })

  it('clears corrupt completedAt on open→open (destination invariant)', () => {
    const next = applyStatus(
      item({ status: 'todo', completedAt: 99 }),
      'in_progress',
      now,
    )
    expect(next.status).toBe('in_progress')
    expect(next.completedAt).toBeNull()
  })

  it('returns same item when transition disallowed', () => {
    const src = item({ status: 'todo', completedAt: null, updatedAt: 1 })
    const next = applyStatus(src, 'todo', now)
    expect(next).toBe(src)
  })

  it('does not mutate the original item', () => {
    const src = item({ status: 'todo', completedAt: null })
    applyStatus(src, 'done', now)
    expect(src.status).toBe('todo')
    expect(src.completedAt).toBeNull()
  })
})
