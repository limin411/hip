import { describe, expect, it } from 'vitest'
import {
  CANCELLED_STATUS_COLOR,
  colorHexForItem,
  colorKeyForItem,
  DEFAULT_STATUS_COLORS,
  normalizeStatusColors,
  normalizeWorkItemUiPrefs,
} from './statusColors'

describe('colorKeyForItem', () => {
  it('archivedAt wins over status', () => {
    expect(
      colorKeyForItem({ status: 'todo', archivedAt: 1 }),
    ).toBe('archived')
    expect(
      colorKeyForItem({ status: 'done', archivedAt: 1 }),
    ).toBe('archived')
  })

  it('cancelled is distinct key', () => {
    expect(colorKeyForItem({ status: 'cancelled', archivedAt: null })).toBe(
      'cancelled',
    )
  })

  it('maps primary statuses', () => {
    expect(colorKeyForItem({ status: 'todo', archivedAt: null })).toBe('todo')
    expect(colorKeyForItem({ status: 'in_progress', archivedAt: null })).toBe(
      'in_progress',
    )
    expect(colorKeyForItem({ status: 'done', archivedAt: null })).toBe('done')
  })
})

describe('colorHexForItem', () => {
  it('cancelled hex differs from archived', () => {
    const c = colorHexForItem(
      { status: 'cancelled', archivedAt: null },
      DEFAULT_STATUS_COLORS,
    )
    expect(c).toBe(CANCELLED_STATUS_COLOR)
    expect(c).not.toBe(DEFAULT_STATUS_COLORS.archived)
  })
})

describe('normalizeStatusColors', () => {
  it('fills defaults and accepts valid hex', () => {
    const n = normalizeStatusColors({ todo: '#FF0000', junk: 'x' })
    expect(n.todo).toBe('#ff0000')
    expect(n.done).toBe(DEFAULT_STATUS_COLORS.done)
  })

  it('rejects invalid hex', () => {
    const n = normalizeStatusColors({ todo: 'red', in_progress: '#fff' })
    expect(n.todo).toBe(DEFAULT_STATUS_COLORS.todo)
    expect(n.in_progress).toBe(DEFAULT_STATUS_COLORS.in_progress)
  })
})

describe('normalizeWorkItemUiPrefs', () => {
  it('returns defaults for garbage', () => {
    expect(normalizeWorkItemUiPrefs(null).version).toBe(1)
    expect(normalizeWorkItemUiPrefs({}).statusColors.todo).toBe(
      DEFAULT_STATUS_COLORS.todo,
    )
  })
})
