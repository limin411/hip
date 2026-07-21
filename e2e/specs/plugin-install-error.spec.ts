// Plugin market: tabs, search, and source management (no free-form git install form).
import { expect } from 'expect-webdriverio'
import { leaveSpecialViewsIfOpen, waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { openSettingsPageForE2e, waitForHipE2E } from '../helpers/e2e-hooks.js'
import { closeSettings } from '../helpers/settings.js'
import { SettingsPage } from '../page-objects/SettingsPage.js'

const settings = new SettingsPage()

describe('plugin market marketplace UI @settings @harness', () => {
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

  it('shows market shell with search, tabs, and sources control', async () => {
    const market = await browser.$('[data-testid="plugin-market"]')
    await market.waitForExist({ timeout: 15000 })
    expect(await market.isDisplayed()).toBe(true)

    const search = await browser.$('[data-testid="plugin-market-search"]')
    expect(await search.isExisting()).toBe(true)

    const tabs = await browser.$('[data-testid="plugin-market-tabs"]')
    expect(await tabs.isExisting()).toBe(true)

    const sources = await browser.$('[data-testid="marketplace-sources-open"]')
    expect(await sources.isExisting()).toBe(true)

    // Legacy free-form install form remains absent
    const installOpen = await browser.$('[data-testid="plugin-install-open"]')
    expect(await installOpen.isExisting()).toBe(false)

    const form = await browser.$('[data-testid="plugin-install-form"]')
    expect(await form.isExisting()).toBe(false)
  })
})
