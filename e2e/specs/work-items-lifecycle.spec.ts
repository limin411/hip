/**
 * Work items full lifecycle: create → edit fields → complete/cancel/archive → hard delete.
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
  listContainsTitle,
  getSelectedWorkItemId,
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

  it('WL1: create item from sidebar, set title, appears in todo list', async () => {
    await clickSmartFilter('todo')
    await createWorkItemFromSidebar()
    await setWorkItemTitle(titleA)
    // Disk first (save chain), then list UI
    await waitForCatalogTitle(titleA)
    await waitForListTitle(titleA, 15000)
    const id = await getSelectedWorkItemId()
    expect(id).toBeTruthy()
    expect(id!.startsWith('wi_')).toBe(true)
  })

  it('WL2: catalog on disk has title under work-items/', async () => {
    const cat = await waitForCatalogTitle(titleA)
    const item = cat.items!.find((i) => i.title === titleA)!
    expect(item.status).toBe('todo')
    expect(item.listId).toBe('wl_inbox')
    expect(item.archivedAt).toBeNull()
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
    await clickSmartFilter('todo')
    await waitForListTitle(titleA)
    await waitForCatalogItemMatch(
      (i) => i.title === titleA && i.status === 'todo',
      15000,
      'reopen not on disk',
    )
  })

  it('WL6: archive switches to archived; unarchive; soft-delete → trash → restore', async () => {
    await clickSmartFilter('todo')
    await selectWorkItemByTitle(titleA)
    await archiveSelected()
    // archiveSelected already asserts filter chip → archived
    await waitForListTitle(titleA)
    await clickSmartFilter('all')
    await waitForListTitleGone(titleA)
    await clickSmartFilter('archived')
    await waitForListTitle(titleA)
    await selectWorkItemByTitle(titleA)
    await unarchiveSelected()
    await clickSmartFilter('archived')
    await waitForListTitleGone(titleA)
    await clickSmartFilter('todo')
    await waitForListTitle(titleA)

    await selectWorkItemByTitle(titleA)
    await deleteSelected(true)
    // Soft-delete: gone from live catalog, present in recycle bin UI
    await waitForCatalogItemGone(titleA)
    expect(await (await browser.$('[data-testid="recycle-bin-page"]')).isExisting()).toBe(true)
    await browser.waitUntil(
      async () => {
        const rows = await browser.$$('[data-testid="recycle-bin-row"]')
        for (const r of rows) {
          if ((await r.getText()).includes(titleA)) return true
        }
        return false
      },
      { timeout: 15000, interval: 200, timeoutMsg: 'work item not listed in recycle bin' },
    )
    // Restore from recycle bin
    await browser.execute((title: string) => {
      const rows = document.querySelectorAll('[data-testid="recycle-bin-row"]')
      for (const row of rows) {
        if ((row.textContent ?? '').includes(title)) {
          const btn = row.querySelector(
            '[data-testid="recycle-bin-restore"]',
          ) as HTMLElement | null
          btn?.click()
          return
        }
      }
      throw new Error('restore row not found')
    }, titleA)
    await waitForCatalogTitle(titleA)
    await openWorkItemsFromMenu()
    await clickSmartFilter('todo')
    await waitForListTitle(titleA, 15000)
    // cleanup seed A (soft-delete → recycle bin)
    await selectWorkItemByTitle(titleA)
    await deleteSelected(true)
    await waitForCatalogItemGone(titleA)
  })

  it('WL7: leave surface flushes second item notes; reopen still shows', async () => {
    await openWorkItemsFromMenu()
    await clickSmartFilter('todo')
    await createWorkItemFromSidebar()
    await setWorkItemTitle(titleB)
    await waitForCatalogTitle(titleB)
    await setWorkItemNotes(`persist-on-leave-${stamp}`, { blur: false })
    // Leave without blur notes — leaveWorkItems should commit draft
    await leaveWorkItemsToChats()
    await openWorkItemsFromMenu()
    await clickSmartFilter('todo')
    await waitForListTitle(titleB, 15000)
    await selectWorkItemByTitle(titleB)
    await waitForCatalogItemMatch(
      (i) => i.title === titleB && (i.notes ?? '').includes(`persist-on-leave-${stamp}`),
      20000,
      'notes not flushed on leave',
    )
    // cleanup → lands on recycle bin
    await deleteSelected(true)
    await waitForCatalogItemGone(titleB)
  })
})
