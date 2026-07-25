import { describe, expect, it } from 'vitest'
import {
  INBOX_LIST_ID,
  isWorkItemId,
  isWorkListId,
  mintWorkItemId,
  mintWorkListId,
  WORK_ITEM_ID_RE,
  WORK_LIST_ID_RE,
} from './ids'

describe('work-item ids', () => {
  it('validates prefixes', () => {
    expect(isWorkItemId('wi_abc')).toBe(true)
    expect(isWorkItemId('wi_')).toBe(false)
    expect(isWorkItemId('wl_inbox')).toBe(false)
    expect(isWorkListId(INBOX_LIST_ID)).toBe(true)
    expect(isWorkListId('wl_x')).toBe(true)
    expect(isWorkListId('wi_x')).toBe(false)
  })

  it('minted ids match regexes', () => {
    for (let i = 0; i < 5; i++) {
      expect(WORK_ITEM_ID_RE.test(mintWorkItemId())).toBe(true)
      expect(WORK_LIST_ID_RE.test(mintWorkListId())).toBe(true)
    }
  })
})
