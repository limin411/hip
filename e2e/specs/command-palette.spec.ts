// Phase 2 S5: global command palette open / filter / navigate.
import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  closeCommandPaletteForE2e,
  openCommandPaletteForE2e,
  waitForHipE2E,
} from '../helpers/e2e-hooks.js'

describe('global command palette @smoke @core', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await waitForHipE2E()
  })

  afterEach(async () => {
    const palette = await browser.$('[data-testid="global-command-palette"]')
    if (await palette.isExisting()) {
      await closeCommandPaletteForE2e()
      await palette.waitForExist({ reverse: true, timeout: 5000 }).catch(() => {})
    }
  })

  it('opens palette and lists navigation commands', async () => {
    await openCommandPaletteForE2e()
    const palette = await browser.$('[data-testid="global-command-palette"]')
    await palette.waitForExist({ timeout: 10000 })

    await (await browser.$('[data-testid="global-cmd-nav-chat"]')).waitForExist({ timeout: 5000 })
    await (await browser.$('[data-testid="global-cmd-nav-code"]')).waitForExist({ timeout: 5000 })
    await (await browser.$('[data-testid="global-cmd-nav-history"]')).waitForExist({ timeout: 5000 })
    expect(await (await browser.$('[data-testid="global-cmd-nav-settings"]')).isExisting()).toBe(true)
  })

  it('filters by search and runs nav-history', async () => {
    await openCommandPaletteForE2e()
    const input = await browser.$('[data-testid="global-command-palette-input"]')
    await input.waitForExist({ timeout: 10000 })
    await input.click()
    await browser.keys('历史')

    const historyCmd = await browser.$('[data-testid="global-cmd-nav-history"]')
    await historyCmd.waitForExist({ timeout: 10000 })
    await browser.execute((el: HTMLElement) => el.click(), historyCmd)

    await (await browser.$('[data-testid="session-history"]')).waitForExist({ timeout: 15000 })
    expect(await (await browser.$('[data-testid="session-history"]')).isExisting()).toBe(true)

    // Return to chat so later specs are not stuck on history.
    const back = await browser.$('[data-testid="titlebar-back"]')
    if (await back.isExisting()) {
      await browser.execute((el: HTMLElement) => el.click(), back)
    }
  })
})
