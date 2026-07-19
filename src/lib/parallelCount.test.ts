import { describe, expect, it } from 'vitest'
import {
  PARALLEL_COUNT_MAX,
  PARALLEL_COUNT_MIN,
  clampParallelCount,
  suggestParallelCount,
  type ParallelSuggestReason,
} from './parallelCount'

const ALL_REASONS: ParallelSuggestReason[] = [
  'empty',
  'compare',
  'three',
  'four',
  'single',
  'default',
]

describe('clampParallelCount', () => {
  it('clamps to [MIN, MAX]', () => {
    expect(clampParallelCount(PARALLEL_COUNT_MIN - 1)).toBe(PARALLEL_COUNT_MIN)
    expect(clampParallelCount(PARALLEL_COUNT_MIN)).toBe(PARALLEL_COUNT_MIN)
    expect(clampParallelCount(2)).toBe(2)
    expect(clampParallelCount(3)).toBe(3)
    expect(clampParallelCount(PARALLEL_COUNT_MAX)).toBe(PARALLEL_COUNT_MAX)
    expect(clampParallelCount(PARALLEL_COUNT_MAX + 5)).toBe(PARALLEL_COUNT_MAX)
  })

  it('defaults invalid numbers to 2', () => {
    expect(clampParallelCount(Number.NaN)).toBe(2)
    expect(clampParallelCount(Number.POSITIVE_INFINITY)).toBe(2)
  })
})

describe('suggestParallelCount', () => {
  it('defaults empty to 2 with empty reasonCode', () => {
    expect(suggestParallelCount('').n).toBe(2)
    expect(suggestParallelCount('').reasonCode).toBe('empty')
    expect(suggestParallelCount('   ').n).toBe(2)
    expect(suggestParallelCount('   ').reasonCode).toBe('empty')
  })

  it('suggests 2 for compare language', () => {
    expect(suggestParallelCount('compare two approaches for caching').n).toBe(2)
    expect(suggestParallelCount('compare two approaches for caching').reasonCode).toBe('compare')
    expect(suggestParallelCount('对比两种实现').n).toBe(2)
    expect(suggestParallelCount('对比两种实现').reasonCode).toBe('compare')
  })

  it('suggests 3 for three-way language', () => {
    expect(suggestParallelCount('try three approaches for the API').n).toBe(3)
    expect(suggestParallelCount('try three approaches for the API').reasonCode).toBe('three')
    expect(suggestParallelCount('三种方案都试一下').n).toBe(3)
    expect(suggestParallelCount('三种方案都试一下').reasonCode).toBe('three')
  })

  it('suggests 4 for exhaustive language', () => {
    expect(suggestParallelCount('exhaustive matrix of four options').n).toBe(4)
    expect(suggestParallelCount('exhaustive matrix of four options').reasonCode).toBe('four')
  })

  it('suggests 1 for single fix language', () => {
    expect(suggestParallelCount('fix typo in README only').n).toBe(1)
    expect(suggestParallelCount('fix typo in README only').reasonCode).toBe('single')
    expect(suggestParallelCount('只改一个文件的 rename').n).toBe(1)
    expect(suggestParallelCount('只改一个文件的 rename').reasonCode).toBe('single')
  })

  it('defaults other goals to 2', () => {
    expect(suggestParallelCount('improve auth reliability').n).toBe(2)
    expect(suggestParallelCount('improve auth reliability').reasonCode).toBe('default')
  })

  it('always returns n in bounds with non-empty rationale and valid reasonCode', () => {
    for (const g of ['', 'x', 'compare two', 'fix bug', 'four ways', '三种']) {
      const s = suggestParallelCount(g)
      expect(s.n).toBeGreaterThanOrEqual(PARALLEL_COUNT_MIN)
      expect(s.n).toBeLessThanOrEqual(PARALLEL_COUNT_MAX)
      expect(s.rationale.length).toBeGreaterThan(0)
      expect(ALL_REASONS).toContain(s.reasonCode)
    }
  })
})
