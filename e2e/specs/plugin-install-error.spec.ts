// Plugin market is a read-only built-in catalog; install UI was removed.
import { expect } from 'expect-webdriverio'
import { leaveSpecialViewsIfOpen, waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { openSettingsPageForE2e, waitForHipE2E } from '../helpers/e2e-hooks.js'
import { closeSettings } from '../helpers/settings.js'
import { SettingsPage } from '../page-objects/SettingsPage.js'

const settings = new SettingsPage()

describe('plugin market empty catalog @settings @harness', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
    await waitForHipE2E()
    await openSettingsPageForE2e('plugins')
  })

  after(async () => {
    if (await settings.backButton.isExisting()) await closeSettings()
  })

  it('shows empty marketplace and no install affordances', async () => {
    const market = await browser.$('[data-testid="plugin-market"]')
    await market.waitForExist({ timeout: 15000 })

    const empty = await browser.$('[data-testid="plugin-market-empty"]')
    await empty.waitForExist({ timeout: 10000 })
    expect(await empty.isDisplayed()).toBe(true)

    const installOpen = await browser.$('[data-testid="plugin-install-open"]')
    expect(await installOpen.isExisting()).toBe(false)
  })
})
