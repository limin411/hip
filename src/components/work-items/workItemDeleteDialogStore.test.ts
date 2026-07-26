import { describe, it, expect, beforeEach } from 'vitest'
import {
  closeWorkItemDeleteDialog,
  getWorkItemDeleteDialog,
  openWorkItemDeleteDialog,
  resetWorkItemDeleteDialogStore,
  subscribeWorkItemDeleteDialog,
} from './workItemDeleteDialogStore'

beforeEach(() => {
  resetWorkItemDeleteDialogStore()
})

describe('workItemDeleteDialogStore', () => {
  it('opens and closes delete dialog', () => {
    expect(getWorkItemDeleteDialog()).toBeNull()
    openWorkItemDeleteDialog('wi_1', 'Ship menus')
    expect(getWorkItemDeleteDialog()).toEqual({ itemId: 'wi_1', title: 'Ship menus' })
    closeWorkItemDeleteDialog()
    expect(getWorkItemDeleteDialog()).toBeNull()
  })

  it('notifies subscribers on open/close', () => {
    let n = 0
    const unsub = subscribeWorkItemDeleteDialog(() => {
      n += 1
    })
    openWorkItemDeleteDialog('a', 't')
    closeWorkItemDeleteDialog()
    // close when already null is a no-op (no emit)
    closeWorkItemDeleteDialog()
    unsub()
    expect(n).toBe(2)
  })
})
