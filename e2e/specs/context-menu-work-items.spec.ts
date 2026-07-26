/**
 * Context menus on Work Items (list / calendar / soft-delete confirm).
 * Prefer UI assertions (list/bar testids) over catalog.json — disk path can lag
 * or differ under HIP_DATA_DIR in some driver setups.
 * Tags: @context-menu @work-items @core
 */
import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp, leaveSpecialViewsIfOpen } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  closeContextMenu,
  contextMenuKindSelector,
  expectContextMenuItems,
  listContextMenuItemIds,
  openAndClickContextMenuItem,
  openContextMenu,
} from '../helpers/context-menu.js'
import {
  clickSmartFilter,
  createWorkItemFromSidebar,
  localTodayYmd,
  openWorkItemsFromMenu,
  saveWorkItemModal,
  setWorkItemTitle,
  switchWorkItemsToCalendarView,
  switchWorkItemsToListView,
  waitForListTitle,
  waitForListTitleGone,
} from '../helpers/work-items.js'

const stamp = Date.now()
const titleList = `e2e-cm-wi-list-${stamp}`
const titleComplete = `e2e-cm-wi-complete-${stamp}`
const titleDelete = `e2e-cm-wi-del-${stamp}`
const titleBar = `e2e-cm-wi-bar-${stamp}`

/** Resolve work-item id from list row testid after title is visible. */
async function rowIdForTitle(title: string): Promise<string> {
  await switchWorkItemsToListView()
  await waitForListTitle(title, 20000)
  const id = await browser.execute((t: string) => {
    const rows = document.querySelectorAll('[data-testid^="work-item-row-"]')
    for (const row of rows) {
      if ((row.textContent ?? '').includes(t)) {
        const tid = row.getAttribute('data-testid') ?? ''
        return tid.replace(/^work-item-row-/, '')
      }
    }
    return ''
  }, title)
  if (!id) throw new Error(`no list row id for title=${JSON.stringify(title)}`)
  return id
}

function workItemRowMenuHost(itemId: string): string {
  return `[data-testid="work-item-row-${itemId}"] ${contextMenuKindSelector('workItem')}`
}

async function createNamedWorkItem(title: string): Promise<string> {
  await openWorkItemsFromMenu({ resetFilter: false })
  await clickSmartFilter('all')
  await createWorkItemFromSidebar()
  await setWorkItemTitle(title)
  await saveWorkItemModal()
  return rowIdForTitle(title)
}

describe('context menu work items @context-menu @work-items @core', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
    await browser.execute(() => {
      try {
        localStorage.removeItem('hip.contextMenu.prefs.v1')
      } catch {
        /* ignore */
      }
    })
    await openWorkItemsFromMenu({ resetFilter: false })
    await clickSmartFilter('all')
  })

  afterEach(async () => {
    await closeContextMenu().catch(() => {})
  })

  it('CM-WI-1: list row menu shows core actions', async () => {
    const id = await createNamedWorkItem(titleList)
    const host = workItemRowMenuHost(id)
    await (await browser.$(host)).waitForExist({ timeout: 10000 })
    await openContextMenu(host)
    await expectContextMenuItems([
      'workItem.open',
      'workItem.copyTitle',
      'workItem.delete',
      'workItem.complete',
    ])
    const ids = await listContextMenuItemIds()
    expect(ids).toContain('workItem.open')
    expect(ids).toContain('workItem.delete')
    await closeContextMenu()
  })

  it('CM-WI-2: menu open opens editor modal', async () => {
    const id = await rowIdForTitle(titleList)
    await openAndClickContextMenuItem(workItemRowMenuHost(id), 'workItem.open')
    const body = await browser.$('[data-testid="work-item-editor-body"]')
    await body.waitForExist({ timeout: 10000 })
    const input = await browser.$('[data-testid="work-item-title-input"]')
    await input.waitForExist({ timeout: 5000 })
    expect(await input.getValue()).toBe(titleList)
    const cancel = await browser.$('[data-testid="work-item-modal-cancel"]')
    if (await cancel.isExisting()) {
      await browser.execute((el: HTMLElement) => el.click(), cancel)
    } else {
      await browser.keys('Escape')
    }
    await browser.waitUntil(
      async () => !(await (await browser.$('[data-testid="work-item-editor-body"]')).isExisting()),
      { timeout: 10000, interval: 100 },
    )
  })

  it('CM-WI-3: menu complete moves item to done filter', async () => {
    const id = await createNamedWorkItem(titleComplete)
    await openAndClickContextMenuItem(workItemRowMenuHost(id), 'workItem.complete')
    // Status matrix / reopen menu ids are unit-tested; e2e asserts product filter effect.
    await clickSmartFilter('done')
    await waitForListTitle(titleComplete, 15000)
    await clickSmartFilter('all')
  })

  it('CM-WI-4: menu delete opens shared confirm then soft-deletes', async () => {
    const id = await createNamedWorkItem(titleDelete)
    await openAndClickContextMenuItem(workItemRowMenuHost(id), 'workItem.delete')
    const confirm = await browser.$('[data-testid="work-item-delete-confirm"]')
    await confirm.waitForExist({ timeout: 10000 })
    await browser.execute((el: HTMLElement) => el.click(), confirm)
    await waitForListTitleGone(titleDelete, 15000)
    await (await browser.$('[data-testid="work-items-page"]')).waitForExist({ timeout: 10000 })
  })

  it('CM-WI-5: delete cancel leaves item in list', async () => {
    await clickSmartFilter('all')
    const id = await rowIdForTitle(titleList)
    await openAndClickContextMenuItem(workItemRowMenuHost(id), 'workItem.delete')
    const confirm = await browser.$('[data-testid="work-item-delete-confirm"]')
    await confirm.waitForExist({ timeout: 10000 })
    // Escape is unreliable with stacked modals; click footer Cancel (sibling before confirm).
    await browser.execute(() => {
      const confirmBtn = document.querySelector('[data-testid="work-item-delete-confirm"]')
      const footer = confirmBtn?.parentElement
      const cancel = footer?.querySelector('button:not([data-testid="work-item-delete-confirm"])')
      ;(cancel as HTMLElement | null)?.click()
    })
    await browser.waitUntil(
      async () => !(await (await browser.$('[data-testid="work-item-delete-confirm"]')).isExisting()),
      { timeout: 8000, interval: 100, timeoutMsg: 'delete confirm still open after Cancel' },
    )
    await waitForListTitle(titleList, 10000)
  })

  it('CM-WI-6: calendar bar menu shows workItem.open', async () => {
    const id = await createNamedWorkItem(titleBar)
    await switchWorkItemsToCalendarView()
    const bar = await browser.$(`[data-testid="work-item-bar-${id}"]`)
    await bar.waitForExist({ timeout: 15000 })
    // Open on DeclarativeContextMenu host wrapping the bar (not the button alone).
    const hostSel = await browser.execute((itemId: string) => {
      const barEl = document.querySelector(`[data-testid="work-item-bar-${itemId}"]`)
      const host = barEl?.closest('[data-context-menu-kind="workItem"]')
      if (!host) return ''
      host.setAttribute('data-e2e-bar-menu', itemId)
      return `[data-e2e-bar-menu="${itemId}"]`
    }, id)
    expect(hostSel).toBeTruthy()
    await openContextMenu(hostSel)
    await expectContextMenuItems(['workItem.open', 'workItem.copyTitle', 'workItem.delete'])
    await closeContextMenu()
  })

  it('CM-WI-7: calendar day blank menu shows create', async () => {
    await switchWorkItemsToCalendarView()
    // Prefer an empty mid-month day so center hit is not a bar (innermost workItem wins).
    const emptyDay = await browser.execute(() => {
      const cells = Array.from(document.querySelectorAll('[data-testid^="work-item-day-"]'))
      for (const cell of cells) {
        if (cell.querySelector('[data-testid^="work-item-bar-"]')) continue
        const blank = cell.querySelector('[data-context-menu-kind="workItemBlank"]')
        if (!blank) continue
        const ymd = cell.getAttribute('data-testid')?.replace('work-item-day-', '') ?? ''
        blank.setAttribute('data-e2e-day-blank', ymd)
        return ymd
      }
      return ''
    })
    expect(emptyDay).toBeTruthy()
    await openContextMenu(`[data-e2e-day-blank="${emptyDay}"]`)
    await expectContextMenuItems(['workItemBlank.create'])
    await closeContextMenu()
  })
})
