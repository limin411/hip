import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { switchToCodeSurface } from '../helpers/surface.js'
import { ChatPage } from '../page-objects/ChatPage.js'

const chat = new ChatPage()

describe('composer widgets', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await switchToCodeSurface()
  })

  it('shows the model picker chip and opens its dropdown', async () => {
    const chip = await chat.modelChip
    await chip.waitForExist({ timeout: 10000 })
    await chip.waitForClickable({ timeout: 10000 })
    // WebKit/Tauri WebDriver in this headless session does not reliably trigger
    // Radix dropdowns with `.click()`, so dispatch `pointerdown` directly.
    await browser.execute((el) => {
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse' }))
    }, chip)
    const menu = await browser.$('[role="menu"]')
    await menu.waitForExist({ timeout: 10000 })
    // CSS animations do not advance in the headless WebKit session, so
    // `isDisplayed()` stays `false` even after the menu opens. Assert
    // `data-state="open"` instead.
    await browser.waitUntil(async () => (await menu.getAttribute('data-state')) === 'open', { timeout: 10000 })
    await browser.keys('Escape')
  })

  it('shows the permission mode picker and lists all three modes', async () => {
    const chip = await chat.permissionChip
    await chip.waitForExist({ timeout: 10000 })
    await chip.waitForClickable({ timeout: 10000 })
    // WebKit/Tauri WebDriver in this headless session does not reliably trigger
    // Radix dropdowns with `.click()`, so dispatch `pointerdown` directly.
    await browser.execute((el) => {
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse' }))
    }, chip)
    const menu = await browser.$('[role="menu"]')
    await menu.waitForExist({ timeout: 10000 })
    const text = await menu.getText()
    expect(text).toContain('仅对话')
    expect(text).toContain('编辑目录内文件')
    expect(text).toContain('完全放开')
    await browser.keys('Escape')
  })

  it('send button is disabled when textarea is empty and no attachments', async () => {
    const send = await chat.composerSend
    expect(await send.isEnabled()).toBe(false)
  })
})
