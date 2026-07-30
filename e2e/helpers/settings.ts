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
      .$('[data-testid="overlay-shell-settings"], [data-testid="settings-nav-general"]')
      .waitForExist({ timeout: 10000 })
    return
  } catch {
    // Fall through to UI button.
  }
  const button = await settings.settingsButton
  await button.waitForExist({ timeout: 10000 })
  await button.click()
  await browser
    .$('[data-testid="overlay-shell-settings"], [data-testid="settings-nav-general"]')
    .waitForExist({ timeout: 10000 })
}

/**
 * Close Settings overlay shell.
 * Prefer closeOverlayForE2e; fallback modal-close / footer re-click.
 * Do not rely on missing titlebar-back / settings-back.
 */
export async function closeSettings(): Promise<void> {
  const shell = await browser.$('[data-testid="overlay-shell-settings"]')
  const page = await browser.$('[data-testid="settings-page"]')
  if (!(await shell.isExisting()) && !(await page.isExisting())) return

  await waitForHipE2E()
  try {
    await closeOverlayForE2e()
  } catch {
    // fall through
  }

  if (
    (await (await browser.$('[data-testid="overlay-shell-settings"]')).isExisting()) ||
    (await (await browser.$('[data-testid="settings-page"]')).isExisting())
  ) {
    const modalClose = await browser.$('[data-testid="modal-close"]')
    if (await modalClose.isExisting()) {
      await browser.execute((el: HTMLElement) => el.click(), modalClose)
    } else {
      const footer = await browser.$('[data-testid="account-settings-button"]')
      if (await footer.isExisting()) {
        await browser.execute((el: HTMLElement) => el.click(), footer)
      }
    }
  }

  await browser.waitUntil(
    async () =>
      !(await (await browser.$('[data-testid="overlay-shell-settings"]')).isExisting()) &&
      !(await (await browser.$('[data-testid="settings-page"]')).isExisting()),
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
