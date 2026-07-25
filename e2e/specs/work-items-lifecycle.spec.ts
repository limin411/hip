/**
 * Work items full lifecycle: create → edit fields → complete/archive → soft delete.
 * Disk asserts under HIP_DATA_DIR/work-items/catalog.json.
 * Tags: @work-items @core
 */
import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp, leaveSpecialViewsIfOpen } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  openWorkItemsFromMenu,
  createWorkItemFromSidebar,
  setWorkItemTitle,
  setWorkItemNotes,
  setWorkItemStatus,
  setWorkItemPriority,
  setWorkItemStartOn,
  setWorkItemEndOn,
  addWorkItemTag,
  saveWorkItemModal,
  waitForCatalogTitle,
  waitForCatalogItemMatch,
  waitForCatalogItemGone,
  waitForListTitle,
  waitForListTitleGone,
  selectWorkItemByTitle,
  toggleCompleteByTitle,
  clickSmartFilter,
  archiveSelected,
  unarchiveSelected,
  deleteSelected,
  localTodayYmd,
  leaveWorkItemsToChats,
} from '../helpers/work-items.js'

describe('work items lifecycle @work-items @core', () => {
  const stamp = Date.now()
  const titleA = `e2e-wi-life-a-${stamp}`
  const titleB = `e2e-wi-life-b-${stamp}`
  const notesMarker = `e2e-wi-notes-${stamp}`
  const tagName = `e2etag${stamp % 100000}`

  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
    await openWorkItemsFromMenu()
  })

  it('WL1: create item from sidebar modal, appears in todo list', async () => {
    await clickSmartFilter('todo')
    await createWorkItemFromSidebar()
    await setWorkItemTitle(titleA)
    await saveWorkItemModal()
    await waitForCatalogTitle(titleA)
    await waitForListTitle(titleA, 15000)
  })

  it('WL2: catalog on disk has title under work-items/', async () => {
    const cat = await waitForCatalogTitle(titleA)
    const item = cat.items!.find((i) => i.title === titleA)!
    expect(item.status).toBe('todo')
    expect(item.listId).toBe('wl_inbox')
    expect(item.archivedAt).toBeNull()
    expect(item.startOn).toBeTruthy()
    expect(item.endOn).toBeTruthy()
  })

  it('WL3: edit status, priority, start/end, tags, notes persist to disk', async () => {
    await selectWorkItemByTitle(titleA)
    await setWorkItemStatus('in_progress')
    await setWorkItemPriority('high')
    const today = localTodayYmd()
    await setWorkItemStartOn(today)
    await setWorkItemEndOn(today)
    await addWorkItemTag(tagName)
    await setWorkItemNotes(notesMarker)
    await saveWorkItemModal()

    const item = await waitForCatalogItemMatch(
      (i) =>
        i.title === titleA &&
        i.status === 'in_progress' &&
        i.priority === 'high' &&
        i.startOn === today &&
        i.endOn === today &&
        (i.tags ?? []).includes(tagName) &&
        (i.notes ?? '').includes(notesMarker),
      20000,
      'WL3 field patch not on disk',
    )
    expect(item.priority).toBe('high')
    expect(item.status).toBe('in_progress')
  })

  it('WL4: complete via checkbox → gone from in_progress; done filter shows it', async () => {
    await clickSmartFilter('in_progress')
    await waitForListTitle(titleA)
    await toggleCompleteByTitle(titleA)
    await waitForListTitleGone(titleA)
    await clickSmartFilter('done')
    await waitForListTitle(titleA)
    await waitForCatalogItemMatch(
      (i) => i.title === titleA && i.status === 'done' && i.completedAt != null,
      15000,
      'done status not on disk',
    )
  })

  it('WL5: reopen from done → todo filter shows it', async () => {
    await clickSmartFilter('done')
    await selectWorkItemByTitle(titleA)
    await setWorkItemStatus('todo')
    await saveWorkItemModal()
    await clickSmartFilter('todo')
    await waitForListTitle(titleA)
    await waitForCatalogItemMatch(
      (i) => i.title === titleA && i.status === 'todo',
      15000,
      'reopen not on disk',
    )
  })

  it('WL6: archive (no filter jump); unarchive; soft-delete stays on page', async () => {
    await clickSmartFilter('todo')
    await selectWorkItemByTitle(titleA)
    await archiveSelected()
    // No forced filter jump — open archived filter to see it
    await clickSmartFilter('all')
    await waitForListTitleGone(titleA)
    await clickSmartFilter('archived')
    await waitForListTitle(titleA)
    await selectWorkItemByTitle(titleA)
    await unarchiveSelected()
    // Save modal if still open after unarchive
    const saveBtn = await browser.$('[data-testid="work-item-modal-save"]')
    if (await saveBtn.isExisting()) {
      await saveWorkItemModal()
    }
    await clickSmartFilter('archived')
    await waitForListTitleGone(titleA)
    await clickSmartFilter('todo')
    await waitForListTitle(titleA)

    await selectWorkItemByTitle(titleA)
    await deleteSelected(true)
    await waitForCatalogItemGone(titleA)
    // Stays on work-items (no forced recycle bin nav)
    await (await browser.$('[data-testid="work-items-page"]')).waitForExist({ timeout: 10000 })
  })

  it('WL7: create second item with notes via modal; leave preserves catalog', async () => {
    await openWorkItemsFromMenu()
    await clickSmartFilter('todo')
    await createWorkItemFromSidebar()
    await setWorkItemTitle(titleB)
    await setWorkItemNotes(`persist-on-leave-${stamp}`)
    await saveWorkItemModal()
    await waitForCatalogTitle(titleB)
    await leaveWorkItemsToChats()
    await openWorkItemsFromMenu()
    await clickSmartFilter('todo')
    await waitForListTitle(titleB, 15000)
    await selectWorkItemByTitle(titleB)
    await waitForCatalogItemMatch(
      (i) => i.title === titleB && (i.notes ?? '').includes(`persist-on-leave-${stamp}`),
      20000,
      'notes not on disk',
    )
    await deleteSelected(true)
    await waitForCatalogItemGone(titleB)
  })
})
