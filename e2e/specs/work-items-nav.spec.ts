/**
 * Work items navigation, empty-title policy, keyboard, command palette.
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
  setWorkItemNotes,
  waitForListTitle,
  waitForListTitleGone,
  selectWorkItemByTitle,
  leaveWorkItemsToChats,
  blurActiveElement,
  clickSmartFilter,
  waitForCatalogTitle,
  waitForCatalogItemGone,
  waitForCatalogItemMatch,
  listContainsTitle,
  getSelectedWorkItemId,
  deleteSelected,
  readWorkItemsCatalog,
} from '../helpers/work-items.js'

describe('work items nav / finalize / keyboard @work-items @core', () => {
  const stamp = Date.now()
  const keepTitle = `e2e-wi-nav-keep-${stamp}`
  const notesOnlyMarker = `nav-notes-only-${stamp}`

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
    // Ensure not already on tasks
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

  it('WN2: empty title + no extras discarded on deselect / leave', async () => {
    await openWorkItemsFromMenu()
    await clickSmartFilter('todo')
    await createWorkItemFromSidebar()
    // Do not set title — leave empty
    const shellId = await getSelectedWorkItemId()
    expect(shellId).toBeTruthy()

    // Escape deselect → finalize discards empty shell
    await blurActiveElement()
    await browser.keys('Escape')
    await browser.pause(200)

    await browser.waitUntil(
      async () => {
        const cat = readWorkItemsCatalog()
        if (!cat) return true
        return !(cat.items ?? []).some((i) => i.id === shellId)
      },
      { timeout: 15000, interval: 200, timeoutMsg: 'empty shell still in catalog after Escape' },
    )
  })

  it('WN3: empty title + notes → Untitled on finalize', async () => {
    await openWorkItemsFromMenu()
    await clickSmartFilter('todo')
    await createWorkItemFromSidebar()
    // Commit notes first (blur notes) while title stays empty.
    await setWorkItemNotes(notesOnlyMarker, { blur: true })
    await waitForCatalogItemMatch(
      (i) => (i.notes ?? '').includes(notesOnlyMarker),
      15000,
      'notes not on disk before title finalize',
    )
    // Blur title (still empty) → finalize promotes to Untitled
    await browser.execute(() => {
      const el = document.querySelector(
        '[data-testid="work-item-title-input"]',
      ) as HTMLInputElement | null
      el?.blur()
    })
    // Also deselect via Escape in case blur alone is a no-op when already blurred.
    await blurActiveElement()
    await browser.keys('Escape')
    await waitForCatalogItemMatch(
      (i) => i.title === 'Untitled' && (i.notes ?? '').includes(notesOnlyMarker),
      15000,
      'Untitled+notes not on disk',
    )
    await clickSmartFilter('todo')
    await selectWorkItemByTitle('Untitled')
    await deleteSelected(true)
  })

  it('WN4: keyboard N creates item; Space toggles complete', async () => {
    await openWorkItemsFromMenu()
    await clickSmartFilter('todo')
    await createWorkItemFromSidebar()
    await setWorkItemTitle(keepTitle)
    await waitForCatalogTitle(keepTitle)
    await waitForListTitle(keepTitle, 15000)

    await blurActiveElement()
    // Create second via N
    await browser.keys('n')
    await (await browser.$('[data-testid="work-item-title-input"]')).waitForExist({
      timeout: 10000,
    })
    const kbdTitle = `e2e-wi-kbd-${stamp}`
    await setWorkItemTitle(kbdTitle)
    await waitForListTitle(kbdTitle)

    await selectWorkItemByTitle(keepTitle)
    await blurActiveElement()
    await browser.keys(' ')
    await clickSmartFilter('todo')
    await waitForListTitleGone(keepTitle)
    await clickSmartFilter('done')
    await waitForListTitle(keepTitle)

    // cleanup both (each delete lands on recycle bin)
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
