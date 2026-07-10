import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { switchToChatSurface, switchToCodeSurface } from '../helpers/surface.js'

/**
 * S3: Chat ↔ Code surface switch is stable without depending on other suites.
 */
describe('surface switch @smoke @core', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
  })

  it('switches to Code surface and shows new-conversation landing', async () => {
    await switchToCodeSurface()
    const landing = await browser.$('[data-testid="new-conversation"]')
    await landing.waitForExist({ timeout: 60000 })
    // Code landing has folder picker (chat does not require pick-folder).
    const pick = await browser.$('[data-testid="pick-folder"]')
    await pick.waitForExist({ timeout: 15000 })
    expect(await pick.isExisting()).toBe(true)
  })

  it('switches back to Chat surface and keeps new-conversation', async () => {
    await switchToChatSurface()
    const landing = await browser.$('[data-testid="new-conversation"]')
    await landing.waitForExist({ timeout: 60000 })
    // Chat surface should not require a project folder chip.
    expect(await (await browser.$('[data-testid="pick-folder"]')).isExisting()).toBe(false)
  })
})
