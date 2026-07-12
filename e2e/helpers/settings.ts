import { openSettingsPageForE2e, waitForHipE2E } from './e2e-hooks.js'
import { SettingsPage } from '../page-objects/SettingsPage.js'

const settings = new SettingsPage()

/**
 * Open Settings → General. Prefer DEV store bridge when available (shared-process residual);
 * fall back to account menu for pure UI path.
 */
export async function openSettings(): Promise<void> {
  try {
    await waitForHipE2E(5000)
    await openSettingsPageForE2e('general')
    await settings.nav('general').waitForExist({ timeout: 10000 })
    return
  } catch {
    // Fall through to UI menu.
  }
  const button = await settings.accountMenuButton
  await button.waitForExist({ timeout: 10000 })
  await button.click()
  const menuItem = await settings.settingsMenuItem
  await menuItem.waitForExist({ timeout: 10000 })
  await menuItem.click()
  await settings.nav('general').waitForExist({ timeout: 10000 })
}

export async function closeSettings(): Promise<void> {
  const back = await settings.backButton
  if (!(await back.isExisting())) return
  await browser.execute((el: HTMLElement) => el.click(), back)
  await browser.waitUntil(
    async () => !(await (await settings.backButton).isExisting()),
    { timeout: 10000, interval: 200 },
  )
}

/** Open General → Context menus configure dialog (item list lives in the modal). */
export async function openContextMenuSettingsDialog(): Promise<void> {
  const row = await browser.$('[data-testid="context-menu-settings"]')
  await row.waitForExist({ timeout: 15000 })
  const openBtn = await browser.$('[data-testid="context-menu-settings-open"]')
  await openBtn.waitForExist({ timeout: 10000 })
  await browser.execute((el: HTMLElement) => el.click(), openBtn)
  const dialog = await browser.$('[data-testid="context-menu-settings-dialog"]')
  await dialog.waitForExist({ timeout: 10000 })
}
