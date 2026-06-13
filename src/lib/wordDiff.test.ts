import { describe, it, expect } from 'vitest'
import { wordDiff, computeHunkWordDiffs } from './wordDiff'
import type { DiffLine } from '@hip/protocol'

describe('wordDiff', () => {
  it('marks only the changed middle span', () => {
    const r = wordDiff('const b = 2', 'const b = 3')
    expect(r.del).toEqual([{ text: 'const b = ', changed: false }, { text: '2', changed: true }])
    expect(r.add).toEqual([{ text: 'const b = ', changed: false }, { text: '3', changed: true }])
  })
  it('all-changed when nothing in common', () => {
    expect(wordDiff('abc', 'xyz')).toEqual({ del: [{ text: 'abc', changed: true }], add: [{ text: 'xyz', changed: true }] })
  })
  it('no changed span for identical content', () => {
    expect(wordDiff('same', 'same')).toEqual({ del: [{ text: 'same', changed: false }], add: [{ text: 'same', changed: false }] })
  })
})

describe('computeHunkWordDiffs', () => {
  it('pairs equal-length del/add runs only', () => {
    const lines: DiffLine[] = [
      { type: 'ctx', content: 'x', oldNo: 1, newNo: 1 },
      { type: 'del', content: 'a1', oldNo: 2, newNo: null },
      { type: 'add', content: 'a2', oldNo: null, newNo: 2 },
    ]
    const out = computeHunkWordDiffs(lines)
    expect(out[0]).toBeNull()
    expect(out[1]).not.toBeNull()
    expect(out[2]).not.toBeNull()
  })
  it('leaves unbalanced runs unpaired (null)', () => {
    const lines: DiffLine[] = [
      { type: 'del', content: 'a', oldNo: 1, newNo: null },
      { type: 'add', content: 'b', oldNo: null, newNo: 1 },
      { type: 'add', content: 'c', oldNo: null, newNo: 2 },
    ]
    expect(computeHunkWordDiffs(lines).every((x) => x === null)).toBe(true)
  })
})
