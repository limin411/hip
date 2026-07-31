import { closeOverlayForE2e, openSettingsPageForE2e, waitForHipE2E } from './e2e-hooks.js'
import { SettingsPage } from '../page-objects/SettingsPage.js'

const settings = new SettingsPage()

/**
 * Open Settings → General. Prefer DEV store bridge when available (shared-process residual);
 * fall back to sidebar settings button for pure UI path.
 */
export async function openSettings(): Promise<void> {
  try {
    await waitForHipE2E(5000)
    await openSettingsPageForE2e('general')
    await browser
      .$('[data-testid="settings-page"], [data-testid="settings-nav-general"]')
      .waitForExist({ timeout: 10000 })
    return
  } catch {
    // Fall through to UI button.
  }
  const button = await settings.settingsButton
  await button.waitForExist({ timeout: 10000 })
  await button.click()
  await browser
    .$('[data-testid="settings-page"], [data-testid="settings-nav-general"]')
    .waitForExist({ timeout: 10000 })
}

/**
 * Close Settings (sidebar + main column mode).
 * Prefer closeOverlayForE2e; fallback settings-sidebar-back.
 */
export async function closeSettings(): Promise<void> {
  const page = await browser.$('[data-testid="settings-page"]')
  if (!(await page.isExisting())) return

  await waitForHipE2E()
  try {
    await closeOverlayForE2e()
  } catch {
    // fall through
  }

  if (await (await browser.$('[data-testid="settings-page"]')).isExisting()) {
    const back = await browser.$('[data-testid="settings-sidebar-back"]')
    if (await back.isExisting()) {
      await browser.execute((el: HTMLElement) => el.click(), back)
    } else {
      const footer = await browser.$('[data-testid="account-settings-button"]')
      if (await footer.isExisting()) {
        await browser.execute((el: HTMLElement) => el.click(), footer)
      }
    }
  }

  await browser.waitUntil(
    async () => !(await (await browser.$('[data-testid="settings-page"]')).isExisting()),
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
