import { describe, it, expect } from 'vitest'
import { buildSplitRows } from './diffSplit'
import type { DiffLine } from '@hip/protocol'

const L = (type: DiffLine['type'], content: string, oldNo: number | null, newNo: number | null): DiffLine => ({ type, content, oldNo, newNo })

describe('buildSplitRows', () => {
  it('pairs del/add and mirrors ctx on both sides', () => {
    const rows = buildSplitRows([L('ctx', 'a', 1, 1), L('del', 'b', 2, null), L('add', 'B', null, 2), L('ctx', 'c', 3, 3)])
    expect(rows).toEqual([
      { left: L('ctx', 'a', 1, 1), right: L('ctx', 'a', 1, 1) },
      { left: L('del', 'b', 2, null), right: L('add', 'B', null, 2) },
      { left: L('ctx', 'c', 3, 3), right: L('ctx', 'c', 3, 3) },
    ])
  })
  it('handles unbalanced runs with nulls', () => {
    const rows = buildSplitRows([L('del', 'x', 1, null), L('add', 'y', null, 1), L('add', 'z', null, 2)])
    expect(rows).toEqual([
      { left: L('del', 'x', 1, null), right: L('add', 'y', null, 1) },
      { left: null, right: L('add', 'z', null, 2) },
    ])
  })
})
