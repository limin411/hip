/**
 * Work items smart filters, search, and user lists CRUD.
 * Tags: @work-items @core
 */
import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp, leaveSpecialViewsIfOpen } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  openWorkItemsFromMenu,
  createWorkItemFromSidebar,
  setWorkItemTitle,
  setWorkItemStatus,
  setWorkItemDueOn,
  setWorkItemList,
  setSearchQuery,
  waitForListTitle,
  waitForListTitleGone,
  selectWorkItemByTitle,
  clickSmartFilter,
  createUserList,
  renameUserList,
  deleteUserList,
  localTodayYmd,
  localYmdDaysAgo,
  waitForCatalogItemMatch,
  waitForCatalogTitle,
  listContainsTitle,
  INBOX_LIST_ID,
  readWorkItemsCatalog,
  deleteSelected,
} from '../helpers/work-items.js'

describe('work items filters & lists @work-items @core', () => {
  const stamp = Date.now()
  const openTitle = `e2e-wi-f-open-${stamp}`
  const todayTitle = `e2e-wi-f-today-${stamp}`
  const overdueTitle = `e2e-wi-f-overdue-${stamp}`
  const progTitle = `e2e-wi-f-prog-${stamp}`
  const listName = `e2e-list-${stamp}`
  const listRenamed = `e2e-list-ren-${stamp}`
  const listItemTitle = `e2e-wi-f-listitem-${stamp}`
  let userListId = ''

  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
    await openWorkItemsFromMenu()
  })

  it('WF1: seed items for open / today / overdue / in_progress', async () => {
    await clickSmartFilter('open')

    await createWorkItemFromSidebar()
    await setWorkItemTitle(openTitle)

    await createWorkItemFromSidebar()
    await setWorkItemTitle(todayTitle)
    await setWorkItemDueOn(localTodayYmd())

    await createWorkItemFromSidebar()
    await setWorkItemTitle(overdueTitle)
    await setWorkItemDueOn(localYmdDaysAgo(3))

    await createWorkItemFromSidebar()
    await setWorkItemTitle(progTitle)
    await setWorkItemStatus('in_progress')

    await waitForCatalogTitle(openTitle)
    await waitForCatalogTitle(todayTitle)
    await waitForCatalogTitle(overdueTitle)
    await waitForCatalogTitle(progTitle)
  })

  it('WF2: smart filters isolate each seeded item', async () => {
    await clickSmartFilter('today')
    await waitForListTitle(todayTitle)
    expect(await listContainsTitle(overdueTitle)).toBe(false)
    expect(await listContainsTitle(openTitle)).toBe(false)

    await clickSmartFilter('overdue')
    await waitForListTitle(overdueTitle)
    expect(await listContainsTitle(todayTitle)).toBe(false)

    await clickSmartFilter('in_progress')
    await waitForListTitle(progTitle)
    expect(await listContainsTitle(openTitle)).toBe(false)

    await clickSmartFilter('open')
    await waitForListTitle(openTitle)
    await waitForListTitle(todayTitle)
    await waitForListTitle(overdueTitle)
    await waitForListTitle(progTitle)
  })

  it('WF3: search filters by title substring', async () => {
    await clickSmartFilter('open')
    // Use a unique mid-segment — trailing stamp is shared across seeded titles.
    await setSearchQuery('f-today-')
    await waitForListTitle(todayTitle)
    expect(await listContainsTitle(openTitle)).toBe(false)
    expect(await listContainsTitle(overdueTitle)).toBe(false)
    await setSearchQuery('')
    await waitForListTitle(openTitle)
  })

  it('WF4: create user list, assign item, list filter shows only it', async () => {
    userListId = await createUserList(listName)
    expect(userListId.startsWith('wl_')).toBe(true)
    expect(userListId).not.toBe(INBOX_LIST_ID)

    // Create under the new list filter (createItem uses current list filter)
    await createWorkItemFromSidebar()
    await setWorkItemTitle(listItemTitle)
    await waitForCatalogItemMatch(
      (i) => i.title === listItemTitle && i.listId === userListId,
      15000,
      'list item not on user list in catalog',
    )
    await waitForListTitle(listItemTitle)

    // open filter still shows list item (open + not archived)
    await clickSmartFilter('open')
    await waitForListTitle(listItemTitle)

    // Switch item openTitle to user list via detail
    await selectWorkItemByTitle(openTitle)
    await setWorkItemList(userListId)
    await waitForCatalogItemMatch(
      (i) => i.title === openTitle && i.listId === userListId,
      15000,
      'moved item listId',
    )

    const listBtn = await browser.$(`[data-testid="sidebar-work-item-list-${userListId}"]`)
    await browser.execute((el: HTMLElement) => el.click(), listBtn)
    await waitForListTitle(listItemTitle)
    await waitForListTitle(openTitle)
    // inbox-only item should not appear when filtering by user list
    // (overdue/today still in inbox unless moved)
    expect(await listContainsTitle(overdueTitle)).toBe(false)
  })

  it('WF5: rename list; delete list migrates items to inbox', async () => {
    await renameUserList(userListId, listRenamed)
    const btn = await browser.$(`[data-testid="sidebar-work-item-list-${userListId}"]`)
    expect((await btn.getText()).includes(listRenamed)).toBe(true)

    await deleteUserList(userListId, true)
    await browser.waitUntil(
      async () =>
        !(await (
          await browser.$(`[data-testid="sidebar-work-item-list-${userListId}"]`)
        ).isExisting()),
      { timeout: 10000, interval: 150, timeoutMsg: 'user list still in sidebar after delete' },
    )

    await waitForCatalogItemMatch(
      (i) => i.title === listItemTitle && i.listId === INBOX_LIST_ID,
      15000,
      'list item not migrated to inbox',
    )
    const cat = readWorkItemsCatalog()
    expect((cat?.lists ?? []).some((l) => l.id === userListId)).toBe(false)

    await clickSmartFilter('open')
    await waitForListTitle(listItemTitle)
  })

  it('WF6: cleanup seeded items (hard delete)', async () => {
    await clickSmartFilter('open')
    for (const t of [openTitle, todayTitle, overdueTitle, progTitle, listItemTitle]) {
      if (await listContainsTitle(t)) {
        await selectWorkItemByTitle(t)
        await deleteSelected(true)
        await waitForListTitleGone(t)
      }
    }
  })
})
