// Unpaid memory Settings UI e2e (seed via __hipE2E, no LLM).
import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { waitForHipE2E } from '../helpers/e2e-hooks.js'
import {
  closeMemorySettings,
  enableMemoryBoth,
  listMemories,
  openMemorySettings,
  seedMemoryItem,
  waitForMemoryListItem,
} from '../helpers/memory.js'

describe('memory settings @memory', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await waitForHipE2E()
  })

  after(async () => {
    const back = await browser.$('[data-testid="settings-back"]')
    if (await back.isExisting()) await closeMemorySettings()
  })

  it('M2.1 opens Settings → Memory panel', async () => {
    await openMemorySettings()
    const empty = await browser.$('[data-testid="memory-config-empty"]')
    const panel = await browser.$('[data-testid="memory-config"]')
    expect((await empty.isExisting()) || (await panel.isExisting())).toBe(true)
  })

  it('M2.2 enables both use and generate from empty CTA', async () => {
    await openMemorySettings()
    await enableMemoryBoth()
    const panel = await browser.$('[data-testid="memory-config"]')
    await expect(panel).toBeDisplayed()
    const useSwitch = await browser.$('[data-testid="memory-switch-use"]')
    await useSwitch.waitForExist({ timeout: 10000 })
    expect(await useSwitch.isExisting()).toBe(true)
  })

  it('M2.4 seeds an item and shows it in the list', async () => {
    await openMemorySettings()
    await enableMemoryBoth()
    const token = `m2-seed-${Date.now()}`
    const item = await seedMemoryItem({
      title: token,
      content: `content for ${token}`,
      kind: 'preference',
      scope: 'global',
    })
    expect(item.id).toBeTruthy()

    // Re-open / refresh list view
    const filterActive = await browser.$('[data-testid="memory-filter-active"]')
    if (await filterActive.isExisting()) {
      await filterActive.click()
    }
    // Force list refresh by toggling away and back is heavy; re-seed list via UI reload:
    await closeMemorySettings()
    await openMemorySettings()
    await waitForMemoryListItem(item.id, 20000)

    const row = await browser.$(`[data-testid="memory-item-${item.id}"]`)
    await expect(row).toBeDisplayed()
    const text = await row.getText()
    expect(text).toContain(token)

    const listed = await listMemories({ status: 'active', limit: 50 })
    expect(listed.some((m) => m.id === item.id)).toBe(true)
  })

  it('M2.5 pins an item via UI', async () => {
    await openMemorySettings()
    await enableMemoryBoth()
    const token = `m2-pin-${Date.now()}`
    const item = await seedMemoryItem({
      title: token,
      content: `pin ${token}`,
      kind: 'preference',
      scope: 'global',
      pinned: false,
    })
    await closeMemorySettings()
    await openMemorySettings()
    await waitForMemoryListItem(item.id)

    const pinBtn = await browser.$(`[data-testid="memory-pin-${item.id}"]`)
    await pinBtn.waitForClickable({ timeout: 10000 })
    await pinBtn.click()

    await browser.waitUntil(
      async () => {
        const badge = await browser.$(`[data-testid="memory-pinned-badge-${item.id}"]`)
        return badge.isExisting()
      },
      { timeout: 15000, interval: 300, timeoutMsg: 'pinned badge not shown' },
    )
  })

  it('M2.6 edits title via modal', async () => {
    await openMemorySettings()
    await enableMemoryBoth()
    const token = `m2-edit-${Date.now()}`
    const item = await seedMemoryItem({
      title: token,
      content: `edit ${token}`,
      kind: 'lesson',
      scope: 'global',
    })
    await closeMemorySettings()
    await openMemorySettings()
    await waitForMemoryListItem(item.id)

    const editBtn = await browser.$(`[data-testid="memory-edit-${item.id}"]`)
    await editBtn.waitForClickable({ timeout: 10000 })
    await editBtn.click()

    const titleInput = await browser.$('[data-testid="memory-edit-title"]')
    await titleInput.waitForExist({ timeout: 10000 })
    await titleInput.clearValue()
    await titleInput.setValue(`${token}-updated`)
    const save = await browser.$('[data-testid="memory-edit-save"]')
    await save.click()

    await browser.waitUntil(
      async () => {
        const row = await browser.$(`[data-testid="memory-item-${item.id}"]`)
        if (!(await row.isExisting())) return false
        const t = await row.getText()
        return t.includes(`${token}-updated`)
      },
      { timeout: 15000, interval: 300, timeoutMsg: 'edited title not visible' },
    )
  })

  it('M2.7 soft delete → trash → restore', async () => {
    await openMemorySettings()
    await enableMemoryBoth()
    const token = `m2-trash-${Date.now()}`
    const item = await seedMemoryItem({
      title: token,
      content: `trash ${token}`,
      kind: 'lesson',
      scope: 'global',
    })
    await closeMemorySettings()
    await openMemorySettings()
    await waitForMemoryListItem(item.id)

    const delBtn = await browser.$(`[data-testid="memory-delete-${item.id}"]`)
    await delBtn.waitForClickable({ timeout: 10000 })
    await delBtn.click()
    const confirm = await browser.$('[data-testid="memory-delete-confirm"]')
    await confirm.waitForClickable({ timeout: 10000 })
    await confirm.click()

    await browser.waitUntil(
      async () => !(await browser.$(`[data-testid="memory-item-${item.id}"]`).isExisting()),
      { timeout: 15000, interval: 300 },
    )

    const trashFilter = await browser.$('[data-testid="memory-filter-trash"]')
    await trashFilter.waitForClickable({ timeout: 10000 })
    await trashFilter.click()
    await waitForMemoryListItem(item.id, 15000)

    const restoreBtn = await browser.$(`[data-testid="memory-restore-${item.id}"]`)
    await restoreBtn.waitForClickable({ timeout: 10000 })
    await restoreBtn.click()

    const activeFilter = await browser.$('[data-testid="memory-filter-active"]')
    await activeFilter.click()
    await waitForMemoryListItem(item.id, 15000)
  })

  it('M2.13 hybrid switch disabled without embedding model', async () => {
    await openMemorySettings()
    await enableMemoryBoth()
    const hybrid = await browser.$('[data-testid="memory-switch-hybrid"]')
    await hybrid.waitForExist({ timeout: 10000 })
    // Switch is a native button role=switch; disabled when no embedding model.
    const isDisabled = await hybrid.getProperty('disabled')
    if (isDisabled) {
      expect(isDisabled).toBe(true)
    } else {
      const hint = await browser.$('[data-testid="memory-hybrid-needs-embed"]')
      expect(await hint.isExisting()).toBe(true)
    }
  })
})
