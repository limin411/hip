/**
 * Context menus on Recycle Bin rows (trashEntry).
 * Seeds trash via work-item soft-delete (UI path; no catalog.json dependency).
 * Tags: @context-menu @trash @core
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
import { closeTrash, openTrash } from '../helpers/trash.js'
import {
  clickSmartFilter,
  createWorkItemFromSidebar,
  openWorkItemsFromMenu,
  saveWorkItemModal,
  setWorkItemTitle,
  switchWorkItemsToListView,
  waitForListTitle,
  waitForListTitleGone,
} from '../helpers/work-items.js'

const stamp = Date.now()
const titleTrash = `e2e-cm-trash-${stamp}`
const titleRestore = `e2e-cm-trash-restore-${stamp}`

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

async function createAndSoftDelete(title: string): Promise<void> {
  await openWorkItemsFromMenu({ resetFilter: false })
  await clickSmartFilter('all')
  await createWorkItemFromSidebar()
  await setWorkItemTitle(title)
  await saveWorkItemModal()
  const id = await rowIdForTitle(title)
  await openAndClickContextMenuItem(workItemRowMenuHost(id), 'workItem.delete')
  const confirm = await browser.$('[data-testid="work-item-delete-confirm"]')
  await confirm.waitForExist({ timeout: 10000 })
  await browser.execute((el: HTMLElement) => el.click(), confirm)
  await waitForListTitleGone(title, 15000)
}

async function waitForTrashRowHost(title: string, timeoutMs = 20000): Promise<string> {
  const filterWi = await browser.$('[data-testid="recycle-bin-filter-work-items"]')
  if (await filterWi.isExisting()) {
    await browser.execute((el: HTMLElement) => el.click(), filterWi)
  }
  let hostSel = ''
  await browser.waitUntil(
    async () => {
      hostSel = await browser.execute((t: string) => {
        const rows = document.querySelectorAll('[data-testid="recycle-bin-row"]')
        for (const row of rows) {
          if ((row.textContent ?? '').includes(t)) {
            const host = row.querySelector('[data-context-menu-kind="trashEntry"]')
            if (host) {
              const key = row.getAttribute('data-row-key')
              return key
                ? `[data-testid="recycle-bin-row"][data-row-key="${key}"] [data-context-menu-kind="trashEntry"]`
                : '[data-testid="recycle-bin-row"] [data-context-menu-kind="trashEntry"]'
            }
          }
        }
        return ''
      }, title)
      return Boolean(hostSel)
    },
    {
      timeout: timeoutMs,
      interval: 250,
      timeoutMsg: `trash row not found for title=${JSON.stringify(title)}`,
    },
  )
  return hostSel
}

describe('context menu trash @context-menu @trash @core', () => {
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
  })

  afterEach(async () => {
    await closeContextMenu().catch(() => {})
  })

  after(async () => {
    await closeTrash().catch(() => {})
  })

  it('CM-TR-1: trash row menu shows restore / copy / hardDelete', async () => {
    await createAndSoftDelete(titleTrash)
    await openTrash()
    const host = await waitForTrashRowHost(titleTrash)
    await openContextMenu(host)
    await expectContextMenuItems([
      'trashEntry.restore',
      'trashEntry.copyTitle',
      'trashEntry.hardDelete',
    ])
    const ids = await listContextMenuItemIds()
    expect(ids).toContain('trashEntry.restore')
    expect(ids).toContain('trashEntry.hardDelete')
    await closeContextMenu()
  })

  it('CM-TR-3: hardDelete opens permanent-delete modal (cancel, no side effect)', async () => {
    await openTrash()
    const host = await waitForTrashRowHost(titleTrash)
    await openAndClickContextMenuItem(host, 'trashEntry.hardDelete')
    await browser.waitUntil(
      async () => {
        const text = await browser.execute(() => document.body.innerText || '')
        return text.includes(titleTrash) || /permanent|永久/i.test(text)
      },
      { timeout: 10000, interval: 200, timeoutMsg: 'hard-delete modal did not open' },
    )
    await browser.keys('Escape')
    await browser.pause(200)
    await waitForTrashRowHost(titleTrash, 10000)
  })

  it('CM-TR-2: menu restore removes row from trash', async () => {
    await createAndSoftDelete(titleRestore)
    await openTrash()
    const host = await waitForTrashRowHost(titleRestore)
    await openAndClickContextMenuItem(host, 'trashEntry.restore')
    await browser.waitUntil(
      async () => {
        const still = await browser.execute((t: string) => {
          const rows = document.querySelectorAll('[data-testid="recycle-bin-row"]')
          for (const row of rows) {
            if ((row.textContent ?? '').includes(t)) return true
          }
          return false
        }, titleRestore)
        return !still
      },
      {
        timeout: 15000,
        interval: 200,
        timeoutMsg: `trash row still shows ${titleRestore} after restore`,
      },
    )
    // Restored item should reappear under work-items all filter
    await openWorkItemsFromMenu({ resetFilter: false })
    await clickSmartFilter('all')
    await waitForListTitle(titleRestore, 15000)
  })
})
