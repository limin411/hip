/**
 * Composer voice dictation (local whisper / HIP_VOICE_MOCK).
 *
 * CI should set HIP_VOICE_MOCK=1 so the Rust voice path does not need a real
 * whisper-cli binary or microphone. Settings enable is still required (opt-in).
 *
 * Tags: @voice @settings @core
 */
import { expect } from 'expect-webdriverio'
import { leaveSpecialViewsIfOpen, waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { openSettingsPageForE2e, waitForHipE2E } from '../helpers/e2e-hooks.js'
import { closeSettings } from '../helpers/settings.js'
import { switchToChatSurface } from '../helpers/surface.js'
import { clickComposerMic } from '../helpers/voice.js'
import { SettingsPage } from '../page-objects/SettingsPage.js'

const settings = new SettingsPage()

async function openVoiceSettings(): Promise<void> {
  await waitForHipE2E(10000)
  await openSettingsPageForE2e('voice')
  const enabled = await browser.$('[data-testid="settings-voice-enabled"]')
  await enabled.waitForExist({ timeout: 15000 })
}

async function setVoiceEnabled(want: boolean): Promise<void> {
  const sw = await browser.$('[data-testid="settings-voice-enabled-switch"]')
  await sw.waitForExist({ timeout: 10000 })
  const checked = (await sw.getAttribute('data-state')) === 'checked' || (await sw.getAttribute('aria-checked')) === 'true'
  if (checked !== want) {
    await browser.execute((el: HTMLElement) => el.click(), sw)
    await browser.waitUntil(
      async () => {
        const state = await sw.getAttribute('data-state')
        const aria = await sw.getAttribute('aria-checked')
        const on = state === 'checked' || aria === 'true'
        return on === want
      },
      { timeout: 10000, interval: 200, timeoutMsg: `voice enabled switch did not become ${want}` },
    )
  }
}

describe('voice dictation @voice @settings @core', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
  })

  after(async () => {
    if (await settings.backButton.isExisting()) {
      await closeSettings()
    }
  })

  it('V1 opens Settings → Voice and shows the master switch', async () => {
    await openVoiceSettings()
    const row = await browser.$('[data-testid="settings-voice-enabled"]')
    await expect(row).toBeDisplayed()
    const sw = await browser.$('[data-testid="settings-voice-enabled-switch"]')
    await expect(sw).toBeExisting()
  })

  it('V2 enables voice and surfaces engine status (mock or binary)', async () => {
    await openVoiceSettings()
    await setVoiceEnabled(true)

    const engine = await browser.$('[data-testid="settings-voice-engine"]')
    await engine.waitForExist({ timeout: 10000 })

    const status = await browser.$('[data-testid="settings-voice-engine-status"]')
    await status.waitForExist({ timeout: 15000 })
    await browser.waitUntil(
      async () => {
        const text = (await status.getText()).trim()
        return text.length > 0
      },
      { timeout: 15000, interval: 300, timeoutMsg: 'voice engine status empty' },
    )
    const text = (await status.getText()).toLowerCase()
    // Mock mode (CI) or real binary path / ready / missing — any non-empty status is fine.
    expect(text.length).toBeGreaterThan(0)
    // When HIP_VOICE_MOCK=1, product copy includes "mock" / "Mock".
    if (process.env.HIP_VOICE_MOCK === '1') {
      expect(/mock/i.test(text)).toBe(true)
    }
  })

  it('V3 shows composer mic after voice is enabled', async () => {
    await openVoiceSettings()
    await setVoiceEnabled(true)
    await closeSettings()
    await switchToChatSurface()

    const newBtn = await browser.$('[data-testid="new-session-button"]')
    if (await newBtn.isExisting()) {
      await newBtn.click()
    }
    const landing = await browser.$('[data-testid="new-conversation"]')
    await landing.waitForExist({ timeout: 15000 })

    const mic = await browser.$('[data-testid="composer-voice-mic"]')
    await mic.waitForExist({ timeout: 15000 })
    await expect(mic).toBeExisting()
    const state = await mic.getAttribute('data-state')
    // idle | unavailable | downloading — product should not crash; idle preferred under mock.
    expect(['idle', 'unavailable', 'downloading', 'recording', 'transcribing']).toContain(state)
  })

  it('V4 disables voice and hides the composer mic', async () => {
    await openVoiceSettings()
    await setVoiceEnabled(false)
    await closeSettings()
    await switchToChatSurface()

    const landing = await browser.$('[data-testid="new-conversation"]')
    if (await landing.isExisting()) {
      // Ensure composer re-renders with config update.
      await browser.pause(300)
    }
    await browser.waitUntil(
      async () => !(await (await browser.$('[data-testid="composer-voice-mic"]')).isExisting()),
      { timeout: 15000, interval: 300, timeoutMsg: 'composer mic still present after voice disabled' },
    )
  })

  it('V5 re-enables voice; mic click is safe under mock (no hard crash)', async () => {
    await openVoiceSettings()
    await setVoiceEnabled(true)
    await closeSettings()
    await switchToChatSurface()

    const mic = await browser.$('[data-testid="composer-voice-mic"]')
    await mic.waitForExist({ timeout: 15000 })
    // Headless CI often has no capture device — only assert click does not tear down the shell.
    try {
      await clickComposerMic(browser)
      await browser.pause(500)
    } catch {
      // Permission / device errors are acceptable; shell must remain.
    }
    const sidebar = await browser.$('[data-testid="app-sidebar"]')
    const toolbar = await browser.$('[data-testid="main-toolbar"]')
    expect((await sidebar.isExisting()) || (await toolbar.isExisting())).toBe(true)
  })
})
