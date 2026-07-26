/**
 * Settings → Context menus: new kinds appear in configure dialog.
 * Tags: @context-menu @settings @core
 */
import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp, leaveSpecialViewsIfOpen } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { closeSettings, openContextMenuSettingsDialog, openSettings } from '../helpers/settings.js'

describe('context menu settings kinds @context-menu @settings @core', () => {
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

  after(async () => {
    await closeSettings().catch(() => {})
  })

  it('CM-SET-1: configure dialog lists workItem, workItemBlank, trashEntry kinds', async () => {
    await openSettings()
    try {
      const panel = await browser.$('[data-testid="context-menu-settings"]')
      await panel.waitForExist({ timeout: 15000 })
      await openContextMenuSettingsDialog()

      for (const kind of ['workItem', 'workItemBlank', 'trashEntry'] as const) {
        const el = await browser.$(`[data-testid="context-menu-settings-kind-${kind}"]`)
        await el.waitForExist({
          timeout: 10000,
          timeoutMsg: `missing settings kind section ${kind}`,
        })
        expect(await el.isExisting()).toBe(true)
      }

      const openItem = await browser.$('[data-testid="context-menu-settings-item-workItem.open"]')
      await openItem.waitForExist({ timeout: 10000 })
      expect(await openItem.isExisting()).toBe(true)

      const restoreItem = await browser.$(
        '[data-testid="context-menu-settings-item-trashEntry.restore"]',
      )
      await restoreItem.waitForExist({ timeout: 10000 })
      expect(await restoreItem.isExisting()).toBe(true)
    } finally {
      // Close dialog if open, then settings
      await browser.keys('Escape').catch(() => {})
      await closeSettings()
    }
  })
})
