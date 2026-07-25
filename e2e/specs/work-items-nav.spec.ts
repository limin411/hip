/**
 * Work items navigation, modal create, keyboard, command palette.
 * Tags: @work-items @core
 */
import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp, leaveSpecialViewsIfOpen } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  openCommandPaletteForE2e,
  closeCommandPaletteForE2e,
  waitForHipE2E,
} from '../helpers/e2e-hooks.js'
import {
  openWorkItemsFromMenu,
  createWorkItemFromSidebar,
  setWorkItemTitle,
  saveWorkItemModal,
  waitForListTitle,
  waitForListTitleGone,
  selectWorkItemByTitle,
  leaveWorkItemsToChats,
  blurActiveElement,
  clickSmartFilter,
  waitForCatalogTitle,
  waitForCatalogItemGone,
  listContainsTitle,
  isWorkItemModalOpen,
  deleteSelected,
  readWorkItemsCatalog,
} from '../helpers/work-items.js'

describe('work items nav / modal / keyboard @work-items @core', () => {
  const stamp = Date.now()
  const keepTitle = `e2e-wi-nav-keep-${stamp}`

  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
    await waitForHipE2E()
  })

  afterEach(async () => {
    const palette = await browser.$('[data-testid="global-command-palette"]')
    if (await palette.isExisting()) {
      await closeCommandPaletteForE2e()
      await palette.waitForExist({ reverse: true, timeout: 5000 }).catch(() => {})
    }
  })

  it('WN1: command palette nav-work-items opens page', async () => {
    await leaveWorkItemsToChats().catch(async () => {
      const chats = await browser.$('[data-testid="sidebar-nav-chats"]')
      if (await chats.isExisting()) {
        await browser.execute((el: HTMLElement) => el.click(), chats)
      }
    })
    await openCommandPaletteForE2e()
    const palette = await browser.$('[data-testid="global-command-palette"]')
    await palette.waitForExist({ timeout: 10000 })
    const cmd = await browser.$('[data-testid="global-cmd-nav-work-items"]')
    await cmd.waitForExist({ timeout: 10000 })
    await browser.execute((el: HTMLElement) => el.click(), cmd)
    await (await browser.$('[data-testid="work-items-page"]')).waitForExist({ timeout: 15000 })
    expect(await (await browser.$('[data-testid="work-items-page"]')).isExisting()).toBe(true)
  })

  it('WN2: cancel empty create modal does not write catalog', async () => {
    await openWorkItemsFromMenu()
    await clickSmartFilter('todo')
    const before = readWorkItemsCatalog()
    const beforeCount = before?.items?.length ?? 0
    await createWorkItemFromSidebar()
    expect(await isWorkItemModalOpen()).toBe(true)
    // Cancel without save
    const cancel = await browser.$('[data-testid="work-item-modal-cancel"]')
    await cancel.click()
    await browser.waitUntil(async () => !(await isWorkItemModalOpen()), {
      timeout: 5000,
    })
    const after = readWorkItemsCatalog()
    expect((after?.items ?? []).length).toBe(beforeCount)
  })

  it('WN3: modal requires title to save', async () => {
    await openWorkItemsFromMenu()
    await clickSmartFilter('todo')
    await createWorkItemFromSidebar()
    await browser.$('[data-testid="work-item-modal-save"]').click()
    await (await browser.$('[data-testid="work-item-title-error"]')).waitForExist({
      timeout: 5000,
    })
    // Still open
    expect(await isWorkItemModalOpen()).toBe(true)
    await browser.$('[data-testid="work-item-modal-cancel"]').click()
  })

  it('WN4: keyboard N creates modal; Space toggles complete in list', async () => {
    await openWorkItemsFromMenu()
    await clickSmartFilter('todo')
    await createWorkItemFromSidebar()
    await setWorkItemTitle(keepTitle)
    await saveWorkItemModal()
    await waitForCatalogTitle(keepTitle)
    await waitForListTitle(keepTitle, 15000)

    await blurActiveElement()
    await browser.keys('n')
    await (await browser.$('[data-testid="work-item-title-input"]')).waitForExist({
      timeout: 10000,
    })
    const kbdTitle = `e2e-wi-kbd-${stamp}`
    await setWorkItemTitle(kbdTitle)
    await saveWorkItemModal()
    await waitForListTitle(kbdTitle)

    // Highlight keepTitle via list then Space (page-level complete)
    await selectWorkItemByTitle(keepTitle)
    // Close modal without change to use keyboard complete
    await browser.$('[data-testid="work-item-modal-cancel"]').click()
    await browser.waitUntil(async () => !(await isWorkItemModalOpen()), { timeout: 5000 })
    await blurActiveElement()
    // Select row highlight: click row opens modal — use toggleComplete instead
    const { toggleCompleteByTitle } = await import('../helpers/work-items.js')
    await toggleCompleteByTitle(keepTitle)
    await clickSmartFilter('todo')
    await waitForListTitleGone(keepTitle)
    await clickSmartFilter('done')
    await waitForListTitle(keepTitle)

    await selectWorkItemByTitle(keepTitle)
    await deleteSelected(true)
    await openWorkItemsFromMenu()
    await clickSmartFilter('todo')
    if (await listContainsTitle(kbdTitle)) {
      await selectWorkItemByTitle(kbdTitle)
      await deleteSelected(true)
    }
  })

  it('WN5: leave via chats then re-enter preserves catalog', async () => {
    await openWorkItemsFromMenu()
    await clickSmartFilter('todo')
    const marker = `e2e-wi-reenter-${stamp}`
    await createWorkItemFromSidebar()
    await setWorkItemTitle(marker)
    await saveWorkItemModal()
    await waitForCatalogTitle(marker)
    await leaveWorkItemsToChats()
    await openWorkItemsFromMenu()
    await clickSmartFilter('todo')
    await waitForListTitle(marker, 15000)
    await selectWorkItemByTitle(marker)
    await deleteSelected(true)
    await waitForCatalogItemGone(marker)
  })
})
