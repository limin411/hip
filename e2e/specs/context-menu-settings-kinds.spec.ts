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

  it('CM-SET-1: configure dialog lists trashEntry kind', async () => {
    await openSettings()
    try {
      const panel = await browser.$('[data-testid="context-menu-settings"]')
      await panel.waitForExist({ timeout: 15000 })
      await openContextMenuSettingsDialog()

      const el = await browser.$('[data-testid="context-menu-settings-kind-trashEntry"]')
      await el.waitForExist({
        timeout: 10000,
        timeoutMsg: 'missing settings kind section trashEntry',
      })
      expect(await el.isExisting()).toBe(true)

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
