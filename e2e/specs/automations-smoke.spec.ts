/**
 * Automations smoke: shell entry, page mount, e2e schedule tick hook.
 * Tags: @smoke @automations
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
  openAutomationsFromMenu,
  expectAutomationsPage,
  leaveAutomationsToChats,
  automationTick,
  readAutomationsCatalog,
} from '../helpers/automations.js'

describe('automations smoke @smoke @automations', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
  })

  afterEach(async () => {
    const palette = await browser.$('[data-testid="global-command-palette"]')
    if (await palette.isExisting()) {
      await closeCommandPaletteForE2e()
      await palette.waitForExist({ reverse: true, timeout: 5000 }).catch(() => {})
    }
  })

  it('AS1: sidebar nav opens AutomationsPage (not placeholder)', async () => {
    await openAutomationsFromMenu()
    await expectAutomationsPage()
    expect(await (await browser.$('[data-testid="automations-page"]')).isExisting()).toBe(true)
    expect(await (await browser.$('[data-testid="placeholder-automation"]')).isExisting()).toBe(
      false,
    )
    // Empty catalog → empty state gallery (fresh HIP_DATA_DIR).
    const empty = await browser.$('[data-testid="automation-empty-state"]')
    const list = await browser.$('[data-testid="automation-list"]')
    expect((await empty.isExisting()) || (await list.isExisting())).toBe(true)
  })

  it('AS2: command palette nav-automations opens page', async () => {
    await leaveAutomationsToChats().catch(async () => {
      const chats = await browser.$('[data-testid="sidebar-nav-chats"]')
      if (await chats.isExisting()) {
        await browser.execute((el: HTMLElement) => el.click(), chats)
      }
    })
    await waitForHipE2E()
    await openCommandPaletteForE2e()
    const palette = await browser.$('[data-testid="global-command-palette"]')
    await palette.waitForExist({ timeout: 10000 })
    const cmd = await browser.$('[data-testid="global-cmd-nav-automations"]')
    await cmd.waitForExist({ timeout: 10000 })
    await browser.execute((el: HTMLElement) => el.click(), cmd)
    await expectAutomationsPage()
  })

  it('AS3: __hipE2E.automationTick is callable (forced due, no 30s wait)', async () => {
    await openAutomationsFromMenu()
    await expectAutomationsPage()
    // Smoke: hook must exist and not throw; empty catalog has nothing due.
    await automationTick(Date.now())
    // Catalog may still be absent or empty after tick — only assert no crash + page alive.
    expect(await (await browser.$('[data-testid="automations-page"]')).isExisting()).toBe(true)
    void readAutomationsCatalog()
  })
})
