import { SettingsPage } from '../page-objects/SettingsPage.js'

const settings = new SettingsPage()

export async function openSettings(): Promise<void> {
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
