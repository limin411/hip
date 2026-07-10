import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { openSettings, closeSettings } from '../helpers/settings.js'
import { SettingsPage } from '../page-objects/SettingsPage.js'

const settings = new SettingsPage()

const PAGES = [
  { id: 'general', label: '通用设置' },
  { id: 'model', label: '模型配置' },
  { id: 'agents', label: '智能体管理' },
  { id: 'mcp', label: '外部工具服务' },
  { id: 'skill', label: '技能' },
  { id: 'plugins', label: '插件' },
] as const

describe('settings smoke @settings @smoke', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await openSettings()
  })

  after(async () => {
    if (await settings.backButton.isExisting()) await closeSettings()
  })

  it('opens the settings page and shows the general tab by default', async () => {
    const panel = await settings.activeTabPanel
    await panel.waitForExist({ timeout: 10000 })
    expect(await panel.getText()).not.toBe('')
  })

  for (const { id, label } of PAGES) {
    it(`switches to the ${id} tab`, async () => {
      const nav = await settings.nav(id)
      await nav.waitForClickable({ timeout: 10000 })
      await nav.click()
      await browser.waitUntil(
        async () => (await nav.getAttribute('aria-selected')) === 'true',
        { timeout: 10000, interval: 200 },
      )
      const panel = await settings.activeTabPanel
      await panel.waitForExist({ timeout: 10000 })
      const text = await panel.getText()
      expect(text.toLowerCase()).toContain(label.toLowerCase())
    })
  }

  it('closes settings with the back button', async () => {
    await closeSettings()
    expect(await settings.backButton.isExisting()).toBe(false)
  })
})
