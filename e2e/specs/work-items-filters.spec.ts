/**
 * Work items smart filters and search.
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
  setSearchQuery,
  waitForListTitle,
  waitForListTitleGone,
  selectWorkItemByTitle,
  clickSmartFilter,
  waitForCatalogTitle,
  listContainsTitle,
  deleteSelected,
} from '../helpers/work-items.js'

describe('work items filters @work-items @core', () => {
  const stamp = Date.now()
  const todoTitle = `e2e-wi-f-todo-${stamp}`
  const progTitle = `e2e-wi-f-prog-${stamp}`
  const doneTitle = `e2e-wi-f-done-${stamp}`

  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
    await openWorkItemsFromMenu()
  })

  it('WF1: seed items for todo / in_progress / done', async () => {
    await clickSmartFilter('todo')

    await createWorkItemFromSidebar()
    await setWorkItemTitle(todoTitle)

    await createWorkItemFromSidebar()
    await setWorkItemTitle(progTitle)
    await setWorkItemStatus('in_progress')

    await createWorkItemFromSidebar()
    await setWorkItemTitle(doneTitle)
    await setWorkItemStatus('done')

    await waitForCatalogTitle(todoTitle)
    await waitForCatalogTitle(progTitle)
    await waitForCatalogTitle(doneTitle)
  })

  it('WF2: smart filters isolate each seeded item', async () => {
    await clickSmartFilter('todo')
    await waitForListTitle(todoTitle)
    expect(await listContainsTitle(progTitle)).toBe(false)
    expect(await listContainsTitle(doneTitle)).toBe(false)

    await clickSmartFilter('in_progress')
    await waitForListTitle(progTitle)
    expect(await listContainsTitle(todoTitle)).toBe(false)
    expect(await listContainsTitle(doneTitle)).toBe(false)

    await clickSmartFilter('done')
    await waitForListTitle(doneTitle)
    expect(await listContainsTitle(todoTitle)).toBe(false)
    expect(await listContainsTitle(progTitle)).toBe(false)
  })

  it('WF3: all filter shows todo + in_progress + done', async () => {
    await clickSmartFilter('all')
    await waitForListTitle(todoTitle)
    await waitForListTitle(progTitle)
    await waitForListTitle(doneTitle)
  })

  it('WF4: search filters by title substring', async () => {
    await clickSmartFilter('all')
    await setSearchQuery('f-prog-')
    await waitForListTitle(progTitle)
    expect(await listContainsTitle(todoTitle)).toBe(false)
    expect(await listContainsTitle(doneTitle)).toBe(false)
    await setSearchQuery('')
    await waitForListTitle(todoTitle)
  })

  it('WF5: cleanup seeded items (hard delete → recycle bin each time)', async () => {
    for (const t of [todoTitle, progTitle, doneTitle]) {
      await openWorkItemsFromMenu()
      await clickSmartFilter('all')
      if (await listContainsTitle(t)) {
        await selectWorkItemByTitle(t)
        await deleteSelected(true)
      }
    }
  })
})
