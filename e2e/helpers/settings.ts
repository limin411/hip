import { SettingsPage } from '../page-objects/SettingsPage.js'

const settings = new SettingsPage()

export async function openSettings(): Promise<void> {
  await settings.accountFooter.click()
  await settings.settingsMenuItem.waitForClickable({ timeout: 10000 })
  await settings.settingsMenuItem.click()
  await settings.nav('general').waitForExist({ timeout: 10000 })
}

export async function closeSettings(): Promise<void> {
  await settings.backButton.click()
  await browser.waitUntil(
    async () => !(await settings.backButton.isExisting()),
    { timeout: 10000, interval: 200 },
  )
}
