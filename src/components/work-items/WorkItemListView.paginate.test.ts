import { describe, expect, it } from 'vitest'
import {
  WORK_ITEM_LIST_PAGE_SIZE,
  paginateWorkItems,
  workItemListTotalPages,
} from './WorkItemListView'

describe('work item list pagination helpers', () => {
  it('computes total pages with a minimum of 1', () => {
    expect(workItemListTotalPages(0)).toBe(1)
    expect(workItemListTotalPages(WORK_ITEM_LIST_PAGE_SIZE)).toBe(1)
    expect(workItemListTotalPages(WORK_ITEM_LIST_PAGE_SIZE + 1)).toBe(2)
  })

  it('slices the requested page', () => {
    const items = Array.from({ length: 35 }, (_, i) => i)
    expect(paginateWorkItems(items, 1)).toEqual(items.slice(0, WORK_ITEM_LIST_PAGE_SIZE))
    expect(paginateWorkItems(items, 2)).toEqual(items.slice(WORK_ITEM_LIST_PAGE_SIZE))
    expect(paginateWorkItems(items, 0)).toEqual(items.slice(0, WORK_ITEM_LIST_PAGE_SIZE))
  })
})
