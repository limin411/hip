import { describe, it, expect } from 'vitest'
import { orderBulkCloseIds } from './orderBulkCloseIds'

describe('orderBulkCloseIds', () => {
  it('returns a copy when active is not in the list', () => {
    const ids = ['a', 'b', 'c']
    expect(orderBulkCloseIds(ids, 'z')).toEqual(['a', 'b', 'c'])
    expect(orderBulkCloseIds(ids, null)).toEqual(['a', 'b', 'c'])
    expect(orderBulkCloseIds(ids, undefined)).toEqual(['a', 'b', 'c'])
  })

  it('moves active session to the end', () => {
    expect(orderBulkCloseIds(['a', 'b', 'c'], 'a')).toEqual(['b', 'c', 'a'])
    expect(orderBulkCloseIds(['a', 'b', 'c'], 'b')).toEqual(['a', 'c', 'b'])
    expect(orderBulkCloseIds(['a', 'b', 'c'], 'c')).toEqual(['a', 'b', 'c'])
  })

  it('handles single active id', () => {
    expect(orderBulkCloseIds(['only'], 'only')).toEqual(['only'])
  })
})
