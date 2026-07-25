/**
 * Work items calendar surface: default month view, day-add create, multi-day bars, view switch.
 * Tags: @work-items @core
 */
import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp, leaveSpecialViewsIfOpen } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  openWorkItemsFromMenu,
  createWorkItemFromSidebar,
  setWorkItemTitle,
  setWorkItemStartOn,
  setWorkItemEndOn,
  pickWorkItemDateToday,
  saveWorkItemModal,
  waitForCatalogTitle,
  waitForCatalogItemMatch,
  waitForListTitle,
  selectWorkItemByTitle,
  deleteSelected,
  clickSmartFilter,
  switchWorkItemsToListView,
  localTodayYmd,
  isWorkItemModalOpen,
} from '../helpers/work-items.js'

function ymdAdd(days: number, base = new Date()): string {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + days)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

describe('work items calendar @work-items @core', () => {
  const stamp = Date.now()
  const spanTitle = `e2e-wi-cal-span-${stamp}`
  const dayTitle = `e2e-wi-cal-day-${stamp}`

  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
    await openWorkItemsFromMenu()
  })

  it('WC1: default surface is month calendar with view mode control', async () => {
    await openWorkItemsFromMenu()
    await (await browser.$('[data-testid="work-item-month-calendar"]')).waitForExist({
      timeout: 15000,
    })
    expect(await (await browser.$('[data-testid="work-item-view-mode"]')).isExisting()).toBe(
      true,
    )
    expect(await (await browser.$('[data-testid="work-item-month-nav"]')).isExisting()).toBe(
      true,
    )
    // List panel hidden until switch
    expect(await (await browser.$('[data-testid="work-item-list-view"]')).isExisting()).toBe(
      false,
    )
  })

  it('WC2: create multi-day item → bar on calendar; list shows range', async () => {
    await clickSmartFilter('all')
    const start = localTodayYmd()
    const end = ymdAdd(2)
    await createWorkItemFromSidebar()
    await setWorkItemTitle(spanTitle)
    await setWorkItemStartOn(start)
    await setWorkItemEndOn(end)
    await saveWorkItemModal()
    await waitForCatalogTitle(spanTitle)

    // Ensure calendar mode and a bar with this title exists
    const calTab = await browser.$('[data-testid="work-item-view-mode-calendar"]')
    if (await calTab.isExisting()) await calTab.click()
    await browser.waitUntil(
      async () =>
        browser.execute((title: string) => {
          const bars = document.querySelectorAll('[data-testid^="work-item-bar-"]')
          for (const b of bars) {
            if ((b.getAttribute('title') ?? b.textContent ?? '').includes(title)) return true
          }
          return false
        }, spanTitle),
      { timeout: 15000, interval: 200, timeoutMsg: 'calendar bar missing for span item' },
    )

    await switchWorkItemsToListView()
    await waitForListTitle(spanTitle)
  })

  it('WC3: day-add opens create modal with that date', async () => {
    await openWorkItemsFromMenu()
    // Ensure calendar mode
    const calTab = await browser.$('[data-testid="work-item-view-mode-calendar"]')
    if (await calTab.isExisting()) await calTab.click()
    await (await browser.$('[data-testid="work-item-month-calendar"]')).waitForExist({
      timeout: 10000,
    })

    const today = localTodayYmd()
    const add = await browser.$(`[data-testid="work-item-day-add-${today}"]`)
    // Hover day to reveal + then click via execute (opacity)
    await browser.execute((ymd: string) => {
      const btn = document.querySelector(
        `[data-testid="work-item-day-add-${ymd}"]`,
      ) as HTMLElement | null
      if (!btn) throw new Error('day-add missing for ' + ymd)
      btn.click()
    }, today)
    await browser.waitUntil(async () => isWorkItemModalOpen(), {
      timeout: 10000,
      timeoutMsg: 'create modal not open from day-add',
    })
    const startVal = await (await browser.$('[data-testid="work-item-start-input"]')).getValue()
    expect(startVal).toBe(today)
    await setWorkItemTitle(dayTitle)
    await saveWorkItemModal()
    await waitForCatalogTitle(dayTitle)
  })

  it('WC4: open old calendar item → DateField day pick + 今天 update start/end', async () => {
    // Past-dated item (the regression: panel opens but day/today had no effect).
    const pastTitle = `e2e-wi-cal-past-${stamp}`
    const pastStart = ymdAdd(-40)
    const pastEnd = ymdAdd(-38)
    await clickSmartFilter('all')
    await createWorkItemFromSidebar()
    await setWorkItemTitle(pastTitle)
    await setWorkItemStartOn(pastStart)
    await setWorkItemEndOn(pastEnd)
    await saveWorkItemModal()
    await waitForCatalogTitle(pastTitle)

    // Re-open from calendar bar if present, else list
    const calTab = await browser.$('[data-testid="work-item-view-mode-calendar"]')
    if (await calTab.isExisting()) await calTab.click()
    await browser.pause(200)
    // Jump month nav toward past so bar is visible is hard; use list select.
    await switchWorkItemsToListView()
    await selectWorkItemByTitle(pastTitle)
    await browser.waitUntil(async () => isWorkItemModalOpen(), {
      timeout: 10000,
      timeoutMsg: 'edit modal not open for past item',
    })

    const today = localTodayYmd()
    // Real UI: Today on start, then set end via day cell
    await pickWorkItemDateToday('work-item-start-input')
    await setWorkItemEndOn(today)
    await saveWorkItemModal()

    await waitForCatalogItemMatch(
      (i) => i.title === pastTitle && i.startOn === today && i.endOn === today,
      20000,
      'past item dates not updated via DateField UI',
    )

    // cleanup this extra item
    await selectWorkItemByTitle(pastTitle)
    await deleteSelected(true)
  })

  it('WC5: switch list ↔ calendar; cleanup', async () => {
    await switchWorkItemsToListView()
    await waitForListTitle(spanTitle)
    await (await browser.$('[data-testid="work-item-view-mode-calendar"]')).click()
    await (await browser.$('[data-testid="work-item-month-calendar"]')).waitForExist({
      timeout: 10000,
    })

    for (const t of [spanTitle, dayTitle]) {
      await openWorkItemsFromMenu()
      await clickSmartFilter('all')
      await selectWorkItemByTitle(t)
      await deleteSelected(true)
    }
  })
})
