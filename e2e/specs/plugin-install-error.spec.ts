// Phase 2 T2: plugin install failure is readable in Settings.
import { expect } from 'expect-webdriverio'
import { leaveSpecialViewsIfOpen, waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  openSettingsPageForE2e,
  simulatePluginInstallError,
  waitForHipE2E,
} from '../helpers/e2e-hooks.js'
import { closeSettings } from '../helpers/settings.js'
import { SettingsPage } from '../page-objects/SettingsPage.js'

const settings = new SettingsPage()
const ERR = 'e2e package structure invalid'

describe('plugin install error @settings @harness', () => {
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

  it('shows install error after submit + failed install result', async () => {
    const openBtn = await browser.$('[data-testid="plugin-install-open"]')
    await openBtn.waitForExist({ timeout: 15000 })
    await browser.execute((el: HTMLElement) => el.click(), openBtn)

    const form = await browser.$('[data-testid="plugin-install-form"]')
    await form.waitForExist({ timeout: 10000 })

    const input = await browser.$('[data-testid="plugin-install-url"]')
    await input.waitForExist({ timeout: 5000 })
    await input.setValue('https://example.invalid/hip-e2e-bad-plugin.git')

    const submit = await browser.$('[data-testid="plugin-install-submit"]')
    await submit.waitForEnabled({ timeout: 5000 })
    await browser.execute((el: HTMLElement) => el.click(), submit)

    // Inject failure after the form is in submitted state (PluginConfig watches result).
    await browser.pause(100)
    await simulatePluginInstallError(ERR)

    const errBox = await browser.$('[data-testid="plugin-install-error"]')
    await errBox.waitForExist({ timeout: 15000 })
    expect(await errBox.getText()).toContain(ERR)
  })
})
