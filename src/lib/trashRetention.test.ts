import { describe, expect, it } from 'vitest'
import {
  daysLeftInTrash,
  DEFAULT_TRASH_RETENTION_DAYS,
  resolveTrashRetentionDays,
} from './trashRetention'
import { formatTrashBadge, trashBadgeTotal } from '@/store/trashBadgeStore'

describe('resolveTrashRetentionDays', () => {
  it('defaults and clamps', () => {
    expect(resolveTrashRetentionDays()).toBe(DEFAULT_TRASH_RETENTION_DAYS)
    expect(resolveTrashRetentionDays(0)).toBe(1)
    expect(resolveTrashRetentionDays(400)).toBe(365)
  })
})

describe('daysLeftInTrash', () => {
  it('computes remaining whole days', () => {
    const now = 10 * 24 * 60 * 60 * 1000
    const deletedAt = now - 2 * 24 * 60 * 60 * 1000
    expect(daysLeftInTrash(deletedAt, 7, now)).toBe(5)
  })
})

describe('formatTrashBadge', () => {
  it('caps at 99+', () => {
    expect(formatTrashBadge(0)).toBe('')
    expect(formatTrashBadge(3)).toBe('3')
    expect(formatTrashBadge(100)).toBe('99+')
    expect(trashBadgeTotal(2, 3)).toBe(5)
  })
})
