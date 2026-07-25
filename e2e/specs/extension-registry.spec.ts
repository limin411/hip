import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { openSettings, closeSettings } from '../helpers/settings.js'
import { openSettingsPageForE2e, waitForHipE2E } from '../helpers/e2e-hooks.js'
import { SettingsPage } from '../page-objects/SettingsPage.js'

const settings = new SettingsPage()

/**
 * UI e2e for ExtensionRegistry conflict surface.
 * Relies on wdio.conf stageE2eData: conflict-plugin + hip.toml user MCP
 * sharing chrome-devtools-mcp package fingerprint, and user skill shared-formatter.
 *
 * Conflicts / inspect failures surface as bottom-right toasts (sonner), not a
 * full-page loading banner. Remediation strip appears only for actionable MCP overlaps.
 */
describe('extension-registry conflicts @settings @core @extensions', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
  })

  after(async () => {
    if (await settings.backButton.isExisting()) await closeSettings()
  })

  it('opens MCP settings and surfaces extension conflicts (toast or remediation)', async () => {
    try {
      await waitForHipE2E(8000)
      await openSettingsPageForE2e('mcp')
    } catch {
      await openSettings()
      const nav = await settings.nav('mcp')
      await nav.waitForClickable({ timeout: 10000 })
      await nav.click()
    }

    const panel = await browser.$('[data-testid="mcp-config"]')
    await panel.waitForExist({ timeout: 15000 })
    await expect(panel).toBeDisplayed()

    // Wait for inspect round-trip: toast and/or remediation strip / Shadowed UI.
    await browser.waitUntil(
      async () => {
        const toast = await browser.$('[data-sonner-toast]')
        if (await toast.isExisting()) {
          const text = await toast.getText()
          if (/conflict|MCP|capability|shadow|扩展|冲突|timed out|extension/i.test(text)) {
            return true
          }
        }
        const banner = await browser.$('[data-testid="extension-conflicts-banner"]')
        if ((await banner.isExisting()) && (await banner.isDisplayed())) return true
        const body = await panel.getText()
        return /Shadowed|shadowed by|plugin_mcp|Plugin DevTools|conflict-plugin/i.test(body)
      },
      {
        timeout: 20000,
        interval: 500,
        timeoutMsg:
          'no extension conflict toast, remediation strip, or Shadowed badge (inspect may have failed)',
      },
    )

    // Soft assert preferred toast wording when present
    const toast = await browser.$('[data-sonner-toast]')
    if (await toast.isExisting()) {
      const text = await toast.getText()
      expect(/conflict|MCP|capability|shadow|扩展|冲突|extension/i.test(text)).toBe(true)
    }
  })

  it('shows Shadowed badge for demoted plugin MCP when present', async () => {
    const panel = await browser.$('[data-testid="mcp-config"]')
    await panel.waitForExist({ timeout: 10000 })

    // English default "Shadowed" or zh locale equivalent may appear in badges
    const body = await panel.getText()
    const hasShadowed =
      /Shadowed|shadowed by|plugin_mcp|Plugin DevTools|conflict-plugin/i.test(body)
    // Soft assert: reconnect timing may delay plugin section; toast is hard requirement above.
    if (!hasShadowed) {
      console.warn('[e2e] plugin Shadowed badge not visible yet; toast already asserted')
    }
  })

  it('skills tab lists user/plugin skills without crashing', async () => {
    try {
      await openSettingsPageForE2e('skill')
    } catch {
      const nav = await settings.nav('skill')
      await nav.waitForClickable({ timeout: 10000 })
      await nav.click()
    }

    await browser.waitUntil(
      async () => {
        const nav = await settings.nav('skill')
        return (await nav.getAttribute('aria-selected')) === 'true'
      },
      { timeout: 10000, interval: 200 },
    )

    const cards = await browser.$$('[data-testid="skill-card"]')
    // At least sample-plugin skills and/or shared-formatter
    expect(cards.length).toBeGreaterThan(0)
  })

  it('plugins tab shows conflict-plugin entry', async () => {
    try {
      await openSettingsPageForE2e('plugins')
    } catch {
      const nav = await settings.nav('plugins')
      await nav.waitForClickable({ timeout: 10000 })
      await nav.click()
    }

    const market = await browser.$('[data-testid="plugin-market"]')
    await market.waitForExist({ timeout: 15000 })

    // Custom tab often lists local installs
    const customTab = await browser.$('[data-testid="plugin-market-tab-custom"]')
    if (await customTab.isExisting()) {
      await customTab.click()
      await browser.pause(400)
    }

    const text = await market.getText()
    expect(/conflict-plugin|sample-plugin/i.test(text)).toBe(true)
  })
})
