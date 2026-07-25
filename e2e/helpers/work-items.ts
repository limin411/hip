/**
 * Work Item Tracking e2e helpers (WebdriverIO + Tauri).
 * Prefer stable data-testids; isolate via HIP_DATA_DIR/work-items/catalog.json.
 */

import fs from 'node:fs'
import path from 'node:path'

/** HIP_DATA_DIR set by wdio.conf (isolated e2e data). */
export function getHipDataDir(): string {
  const dir = process.env.HIP_DATA_DIR
  if (!dir) throw new Error('HIP_DATA_DIR is not set')
  return dir
}

export function getWorkItemsCatalogPath(): string {
  return path.join(getHipDataDir(), 'work-items', 'catalog.json')
}

export type WorkItemsCatalogFile = {
  version?: number
  lists?: Array<{ id: string; name: string; system?: string | null }>
  items?: Array<{
    id: string
    title: string
    status: string
    priority: string
    listId: string
    tags: string[]
    notes: string
    startOn: string | null
    endOn: string | null
    archivedAt: number | null
    completedAt: number | null
  }>
}

export function readWorkItemsCatalog(): WorkItemsCatalogFile | null {
  const p = getWorkItemsCatalogPath()
  if (!fs.existsSync(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as WorkItemsCatalogFile
  } catch {
    return null
  }
}

export async function waitForCatalogTitle(
  title: string,
  timeoutMs = 15000,
): Promise<WorkItemsCatalogFile> {
  let last: WorkItemsCatalogFile | null = null
  await browser.waitUntil(
    async () => {
      last = readWorkItemsCatalog()
      return Boolean(last?.items?.some((i) => i.title === title))
    },
    {
      timeout: timeoutMs,
      interval: 200,
      timeoutMsg: `catalog missing item title=${JSON.stringify(title)} at ${getWorkItemsCatalogPath()}`,
    },
  )
  return last!
}

export async function waitForCatalogItemMatch(
  predicate: (item: NonNullable<WorkItemsCatalogFile['items']>[number]) => boolean,
  timeoutMs = 15000,
  timeoutMsg = 'catalog item match not found',
): Promise<NonNullable<WorkItemsCatalogFile['items']>[number]> {
  let found: NonNullable<WorkItemsCatalogFile['items']>[number] | undefined
  await browser.waitUntil(
    async () => {
      const cat = readWorkItemsCatalog()
      found = cat?.items?.find(predicate)
      return Boolean(found)
    },
    { timeout: timeoutMs, interval: 200, timeoutMsg },
  )
  return found!
}

export async function waitForCatalogItemGone(
  title: string,
  timeoutMs = 15000,
): Promise<void> {
  await browser.waitUntil(
    async () => {
      const cat = readWorkItemsCatalog()
      if (!cat) return true
      return !(cat.items ?? []).some((i) => i.title === title)
    },
    {
      timeout: timeoutMs,
      interval: 200,
      timeoutMsg: `catalog still has title=${JSON.stringify(title)}`,
    },
  )
}

/** Set a React controlled <input|textarea> value and fire input/change. */
export async function setReactInputValue(testid: string, value: string): Promise<void> {
  const input = await browser.$(`[data-testid="${testid}"]`)
  await input.waitForExist({ timeout: 10000 })
  await browser.execute(
    (el: HTMLInputElement | HTMLTextAreaElement, v: string) => {
      el.focus()
      const isTextArea = el.tagName === 'TEXTAREA'
      const proto = isTextArea
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype
      const desc = Object.getOwnPropertyDescriptor(proto, 'value')
      desc?.set?.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    },
    input,
    value,
  )
}

/** Set a React controlled <select> value and fire change. */
export async function setReactSelectValue(testid: string, value: string): Promise<void> {
  const select = await browser.$(`[data-testid="${testid}"]`)
  await select.waitForExist({ timeout: 10000 })
  await browser.execute(
    (el: HTMLSelectElement, v: string) => {
      el.focus()
      const proto = window.HTMLSelectElement.prototype
      const desc = Object.getOwnPropertyDescriptor(proto, 'value')
      desc?.set?.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    },
    select,
    value,
  )
}

async function clickTestId(testid: string, timeout = 15000): Promise<void> {
  const el = await browser.$(`[data-testid="${testid}"]`)
  await el.waitForExist({ timeout })
  await browser.execute((node: HTMLElement) => node.click(), el)
}

/** Open work-items surface via sidebar nav (product path). */
export async function openWorkItemsFromMenu(opts?: { resetFilter?: boolean }): Promise<void> {
  const nav = await browser.$('[data-testid="sidebar-nav-tasks"]')
  await nav.waitForExist({ timeout: 20000 })
  await browser.execute((el: HTMLElement) => el.click(), nav)
  await (await browser.$('[data-testid="work-items-page"]')).waitForExist({ timeout: 20000 })
  await (await browser.$('[data-testid="sidebar-work-items"]')).waitForExist({ timeout: 15000 })
  // Shared Tauri process may leave filterId on a stale filter from prior specs.
  if (opts?.resetFilter !== false) {
    await clickSmartFilter('todo')
  }
}

/** Leave work-items via chats nav (triggers leaveWorkItems flush). */
export async function leaveWorkItemsToChats(): Promise<void> {
  const chats = await browser.$('[data-testid="sidebar-nav-chats"]')
  await chats.waitForExist({ timeout: 15000 })
  await browser.execute((el: HTMLElement) => el.click(), chats)
  await browser.waitUntil(
    async () => !(await (await browser.$('[data-testid="work-items-page"]')).isExisting()),
    {
      timeout: 15000,
      interval: 200,
      timeoutMsg: 'work-items-page still mounted after leave',
    },
  )
}

/** Switch main surface to list (rows + search). */
export async function switchWorkItemsToListView(): Promise<void> {
  const listAlready = await browser.$('[data-testid="work-item-list-view"]')
  if (await listAlready.isExisting()) return
  const tab = await browser.$('[data-testid="work-item-view-mode-list"]')
  await tab.waitForExist({ timeout: 10000 })
  await tab.click()
  await (await browser.$('[data-testid="work-item-list-view"]')).waitForExist({
    timeout: 10000,
  })
}

/** Create item via sidebar "new work item" CTA; waits for modal title input. */
export async function createWorkItemFromSidebar(): Promise<void> {
  await clickTestId('sidebar-new-work-item')
  await (await browser.$('[data-testid="work-item-title-input"]')).waitForExist({
    timeout: 15000,
  })
}

/** Create item (sidebar CTA; modal create). */
export async function createWorkItemFromListPane(): Promise<void> {
  await createWorkItemFromSidebar()
}

/** Persist modal draft (create or edit). */
export async function saveWorkItemModal(): Promise<void> {
  await clickTestId('work-item-modal-save')
  await browser.waitUntil(
    async () => !(await (await browser.$('[data-testid="work-item-editor-body"]')).isExisting()),
    { timeout: 10000, interval: 100, timeoutMsg: 'editor modal still open after save' },
  )
  await browser.pause(120)
}

/** Set title on the open editor modal. */
export async function setWorkItemTitle(title: string, _opts?: { blur?: boolean }): Promise<void> {
  const input = await browser.$('[data-testid="work-item-title-input"]')
  await input.waitForExist({ timeout: 10000 })
  for (let attempt = 0; attempt < 3; attempt++) {
    await setReactInputValue('work-item-title-input', title)
    const ok = await browser.waitUntil(
      async () => (await input.getValue()) === title,
      { timeout: 2000, interval: 50 },
    ).then(() => true).catch(() => false)
    if (ok) break
  }
  await browser.waitUntil(
    async () => (await input.getValue()) === title,
    { timeout: 5000, interval: 50, timeoutMsg: `title input did not accept ${JSON.stringify(title)}` },
  )
  await browser.pause(80)
}

export async function setWorkItemNotes(notes: string, _opts?: { blur?: boolean }): Promise<void> {
  const area = await browser.$('[data-testid="work-item-notes"]')
  await area.waitForExist({ timeout: 10000 })
  for (let attempt = 0; attempt < 3; attempt++) {
    await setReactInputValue('work-item-notes', notes)
    const ok = await browser.waitUntil(
      async () => (await area.getValue()) === notes,
      { timeout: 2000, interval: 50 },
    ).then(() => true).catch(() => false)
    if (ok) break
  }
  await browser.waitUntil(
    async () => (await area.getValue()) === notes,
    { timeout: 5000, interval: 50, timeoutMsg: `notes did not accept ${JSON.stringify(notes)}` },
  )
  await browser.pause(80)
}

export async function setWorkItemStatus(status: string): Promise<void> {
  await setReactSelectValue('work-item-status-select', status)
}

export async function setWorkItemPriority(priority: string): Promise<void> {
  await setReactSelectValue('work-item-priority-select', priority)
}

export async function setWorkItemStartOn(ymd: string | null): Promise<void> {
  await setReactInputValue('work-item-start-input', ymd ?? '')
}

export async function setWorkItemEndOn(ymd: string | null): Promise<void> {
  await setReactInputValue('work-item-end-input', ymd ?? '')
}

/** @deprecated use setWorkItemEndOn */
export async function setWorkItemDueOn(ymd: string | null): Promise<void> {
  await setWorkItemEndOn(ymd)
}

export async function addWorkItemTag(tag: string): Promise<void> {
  await setReactInputValue('work-item-tag-input', tag)
  const input = await browser.$('[data-testid="work-item-tag-input"]')
  await input.click()
  await browser.keys('Enter')
  await browser.waitUntil(
    async () => {
      const tags = await browser.$$('[data-testid="work-item-tag"]')
      for (const t of tags) {
        if ((await t.getText()).includes(tag)) return true
      }
      return false
    },
    { timeout: 5000, interval: 100, timeoutMsg: `tag ${tag} not visible` },
  )
}

/** Local calendar day as YYYY-MM-DD (same formula as domain filter). */
export function localTodayYmd(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function localYmdDaysAgo(days: number, d: Date = new Date()): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() - days)
  return localTodayYmd(x)
}

/** True when editor modal is open (create or edit). */
export async function isWorkItemModalOpen(): Promise<boolean> {
  return (await browser.$('[data-testid="work-item-editor-body"]')).isExisting()
}

/**
 * @deprecated Detail pane removed — returns null; use isWorkItemModalOpen / list rows.
 */
export async function getSelectedWorkItemId(): Promise<string | null> {
  return null
}

/** True if a listbox row whose visible text includes `title` exists. */
export async function listContainsTitle(title: string): Promise<boolean> {
  // Ensure list mode so rows exist.
  const list = await browser.$('[data-testid="work-item-list-view"]')
  if (!(await list.isExisting())) {
    try {
      await switchWorkItemsToListView()
    } catch {
      return false
    }
  }
  return browser.execute((t: string) => {
    const rows = document.querySelectorAll('[data-testid^="work-item-row-"]')
    for (const row of rows) {
      if ((row.textContent ?? '').includes(t)) return true
    }
    return false
  }, title)
}

export async function waitForListTitle(
  title: string,
  timeoutMs = 10000,
): Promise<void> {
  await switchWorkItemsToListView()
  await browser.waitUntil(async () => listContainsTitle(title), {
    timeout: timeoutMs,
    interval: 150,
    timeoutMsg: `list missing title=${JSON.stringify(title)}`,
  })
}

export async function waitForListTitleGone(
  title: string,
  timeoutMs = 10000,
): Promise<void> {
  await switchWorkItemsToListView()
  await browser.waitUntil(async () => !(await listContainsTitle(title)), {
    timeout: timeoutMs,
    interval: 150,
    timeoutMsg: `list still shows title=${JSON.stringify(title)}`,
  })
}

/** Click list row whose text includes title (switches to list view first). */
export async function selectWorkItemByTitle(title: string): Promise<void> {
  await switchWorkItemsToListView()
  await browser.waitUntil(async () => listContainsTitle(title), {
    timeout: 10000,
    interval: 150,
    timeoutMsg: `cannot select missing title=${JSON.stringify(title)}`,
  })
  await browser.execute((t: string) => {
    const rows = document.querySelectorAll('[data-testid^="work-item-row-"]')
    for (const row of rows) {
      if ((row.textContent ?? '').includes(t)) {
        ;(row as HTMLElement).click()
        return
      }
    }
    throw new Error(`row not found for ${t}`)
  }, title)
  await browser.waitUntil(
    async () => {
      const input = await browser.$('[data-testid="work-item-title-input"]')
      if (!(await input.isExisting())) return false
      const v = await input.getValue()
      return v === title || v.includes(title)
    },
    { timeout: 10000, interval: 150, timeoutMsg: `modal not open for ${title}` },
  )
}

/** Toggle complete checkbox on the row for title (list view). */
export async function toggleCompleteByTitle(title: string): Promise<void> {
  await switchWorkItemsToListView()
  await browser.execute((t: string) => {
    const rows = document.querySelectorAll('[data-testid^="work-item-row-"]')
    for (const row of rows) {
      if ((row.textContent ?? '').includes(t)) {
        const btn = row.querySelector('[data-testid^="work-item-complete-"]') as HTMLElement | null
        if (!btn) throw new Error('complete button missing')
        btn.click()
        return
      }
    }
    throw new Error(`row not found for complete: ${t}`)
  }, title)
}

export async function clickSmartFilter(
  filterId: 'all' | 'todo' | 'in_progress' | 'done' | 'archived',
): Promise<void> {
  await clickTestId(`sidebar-work-item-filter-${filterId}`)
  await browser.pause(80)
}

export async function setSearchQuery(q: string): Promise<void> {
  await switchWorkItemsToListView()
  await setReactInputValue('work-item-search', q)
  await browser.pause(80)
}

/** Switch main surface back to month calendar. */
export async function switchWorkItemsToCalendarView(): Promise<void> {
  const cal = await browser.$('[data-testid="work-item-month-calendar"]')
  if (await cal.isExisting()) return
  const tab = await browser.$('[data-testid="work-item-view-mode-calendar"]')
  await tab.waitForExist({ timeout: 10000 })
  await tab.click()
  await (await browser.$('[data-testid="work-item-month-calendar"]')).waitForExist({
    timeout: 10000,
  })
}

export async function archiveSelected(): Promise<void> {
  await clickTestId('work-item-archive')
  // Modal archives (after draft flush) and closes — no filter jump.
  await browser.waitUntil(
    async () => !(await isWorkItemModalOpen()),
    { timeout: 10000, interval: 100, timeoutMsg: 'modal still open after archive' },
  )
}

export async function unarchiveSelected(): Promise<void> {
  await clickTestId('work-item-unarchive')
}

export async function deleteSelected(confirm = true): Promise<void> {
  await clickTestId('work-item-delete')
  await (await browser.$('[data-testid="work-item-delete-confirm"]')).waitForExist({
    timeout: 10000,
  })
  if (confirm) {
    await clickTestId('work-item-delete-confirm')
    // Soft-delete closes modal and stays on work-items (no forced trash nav).
    await browser.waitUntil(
      async () => !(await isWorkItemModalOpen()),
      { timeout: 10000, interval: 100, timeoutMsg: 'modal still open after delete' },
    )
    await expectWorkItemsPage()
  } else {
    // Cancel via modal close
    const close = await browser.$('[data-testid="modal-close"]')
    if (await close.isExisting()) await close.click()
    await browser.pause(100)
  }
}

/** Blur any focused field so keyboard shortcuts apply to the page. */
export async function blurActiveElement(): Promise<void> {
  await browser.execute(() => {
    const el = document.activeElement as HTMLElement | null
    el?.blur?.()
  })
  await browser.pause(50)
}

export async function expectWorkItemsPage(): Promise<void> {
  await (await browser.$('[data-testid="work-items-page"]')).waitForExist({ timeout: 20000 })
}

/** Inbox list id is stable. */
export const INBOX_LIST_ID = 'wl_inbox'
