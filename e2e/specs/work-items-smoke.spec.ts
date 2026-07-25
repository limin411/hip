/**
 * Work items smoke: shell entry, page mount, sidebar IA.
 * Tags: @smoke @work-items
 */
import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp, leaveSpecialViewsIfOpen } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  openWorkItemsFromMenu,
  expectWorkItemsPage,
} from '../helpers/work-items.js'

describe('work items smoke @smoke @work-items', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
  })

  it('WS1: sidebar nav opens WorkItemsPage (not placeholder)', async () => {
    await openWorkItemsFromMenu()
    await expectWorkItemsPage()
    const placeholder = await browser.$('[data-testid="placeholder-tasks"]')
    expect(await placeholder.isExisting()).toBe(false)
    expect(await (await browser.$('[data-testid="work-items-page"]')).isExisting()).toBe(true)
  })

  it('WS2: sidebar smart filters + calendar shell + new CTA (no user lists)', async () => {
    await openWorkItemsFromMenu()
    await (await browser.$('[data-testid="sidebar-work-items"]')).waitForExist({
      timeout: 15000,
    })
    for (const id of ['all', 'todo', 'in_progress', 'done', 'archived'] as const) {
      const el = await browser.$(`[data-testid="sidebar-work-item-filter-${id}"]`)
      expect(await el.isExisting()).toBe(true)
    }
    for (const id of ['open', 'today', 'overdue', 'cancelled'] as const) {
      const el = await browser.$(`[data-testid="sidebar-work-item-filter-${id}"]`)
      expect(await el.isExisting()).toBe(false)
    }
    expect(
      await (await browser.$('[data-testid="sidebar-work-item-list-wl_inbox"]')).isExisting(),
    ).toBe(false)
    expect(await (await browser.$('[data-testid="sidebar-new-work-item"]')).isExisting()).toBe(
      true,
    )
    expect(
      await (await browser.$('[data-testid="sidebar-new-work-item-list"]')).isExisting(),
    ).toBe(false)
    // Calendar-first default
    expect(await (await browser.$('[data-testid="work-item-month-calendar"]')).isExisting()).toBe(
      true,
    )
    expect(await (await browser.$('[data-testid="work-item-view-mode"]')).isExisting()).toBe(true)
  })
})
