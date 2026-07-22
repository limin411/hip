/**
 * Lightweight UX smoke for Phase 3 (Tune / first-run hooks).
 * Tag: @core — unpaid, no live LLM.
 */
import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { switchToCodeSurface } from '../helpers/surface.js'
import { ChatPage } from '../page-objects/ChatPage.js'

const chat = new ChatPage()

describe('ux phase3 smoke @core', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await switchToCodeSurface()
  })

  it('shows composer Tune on code new-conversation', async () => {
    const nc = await chat.newConversation
    await nc.waitForExist({ timeout: 10000 })
    const tune = await chat.composerTune
    await tune.waitForExist({ timeout: 10000 })
    expect(await tune.isExisting()).toBe(true)
  })

  it('opens Tune panel with secondary control host', async () => {
    const tune = await chat.composerTune
    await browser.execute((el: HTMLElement) => {
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse' }))
      el.click()
    }, tune)
    const panel = await chat.composerTunePanel
    await panel.waitForExist({ timeout: 10000 })
    const secondary = await browser.$('[data-testid="composer-controls-secondary"]')
    await secondary.waitForExist({ timeout: 5000 })
    expect(await secondary.isExisting()).toBe(true)
    await browser.keys('Escape')
  })
})
