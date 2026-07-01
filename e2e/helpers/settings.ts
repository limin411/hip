import { SettingsPage } from '../page-objects/SettingsPage.js'

const settings = new SettingsPage()

export async function openSettings(): Promise<void> {
  const footer = await settings.accountFooter
  await footer.waitForExist({ timeout: 10000 })
  // WebKit/Tauri WebDriver does not reliably trigger Radix dropdowns with
  // `.click()`, so dispatch `pointerdown` directly (matches composer-widgets).
  await browser.execute((el: HTMLElement) => {
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse' }))
  }, footer)
  const menuItem = await settings.settingsMenuItem
  await menuItem.waitForExist({ timeout: 10000 })
  await menuItem.click()
  await settings.nav('general').waitForExist({ timeout: 10000 })
}

export async function closeSettings(): Promise<void> {
  await settings.backButton.click()
  await browser.waitUntil(
    async () => !(await settings.backButton.isExisting()),
    { timeout: 10000, interval: 200 },
  )
}
