import { describe, it, expect } from 'vitest'
import {
  DEFAULT_TRASH_RETENTION_DAYS,
  resolveTrashRetentionDays,
  runSessionTrashRetention,
  TRASH_RETENTION_MAX_DAYS,
  TRASH_RETENTION_MIN_DAYS,
} from './trash-retention.js'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'

describe('resolveTrashRetentionDays', () => {
  it('defaults to 7', () => {
    expect(resolveTrashRetentionDays()).toBe(DEFAULT_TRASH_RETENTION_DAYS)
    expect(resolveTrashRetentionDays(null)).toBe(7)
    expect(resolveTrashRetentionDays(Number.NaN)).toBe(7)
  })

  it('clamps to [1, 365]', () => {
    expect(resolveTrashRetentionDays(0)).toBe(TRASH_RETENTION_MIN_DAYS)
    expect(resolveTrashRetentionDays(-3)).toBe(TRASH_RETENTION_MIN_DAYS)
    expect(resolveTrashRetentionDays(999)).toBe(TRASH_RETENTION_MAX_DAYS)
    expect(resolveTrashRetentionDays(14.9)).toBe(14)
  })
})

describe('runSessionTrashRetention', () => {
  it('purges only sessions past retention', () => {
    const { db, ftsEnabled } = openDatabase(':memory:')
    const store = new SessionStore(db, ftsEnabled)
    const now = 20 * 24 * 60 * 60 * 1000
    store.insertSession({ id: 'old', title: 'old', config: '{}', createdAt: 1, updatedAt: 1 })
    store.insertSession({ id: 'new', title: 'new', config: '{}', createdAt: 1, updatedAt: 2 })
    store.softDeleteSession('old', { deletedAt: now - 10 * 24 * 60 * 60 * 1000 })
    store.softDeleteSession('new', { deletedAt: now - 2 * 24 * 60 * 60 * 1000 })

    const purged = runSessionTrashRetention(store, 7, now)
    expect(purged).toEqual(['old'])
    expect(store.getSession('old')).toBeUndefined()
    expect(store.isSessionTrashed('new')).toBe(true)
  })
})
