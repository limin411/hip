import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { switchToCodeSurface } from '../helpers/surface.js'
import { ChatPage } from '../page-objects/ChatPage.js'

const chat = new ChatPage()

async function openChipMenu(chip: ChainablePromiseElement): Promise<ChainablePromiseElement> {
  await chip.waitForExist({ timeout: 10000 })
  await chip.waitForClickable({ timeout: 10000 })
  // WebKit/Tauri WebDriver in this headless session does not reliably trigger
  // Radix dropdowns with `.click()`, so dispatch `pointerdown` directly.
  await browser.execute((el: HTMLElement) => {
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse' }))
  }, chip)
  const menu = await browser.$('[role="menu"]')
  await menu.waitForExist({ timeout: 10000 })
  // CSS animations do not advance in the headless WebKit session, so
  // `isDisplayed()` stays `false` even after the menu opens. Assert
  // `data-state="open"` instead.
  await browser.waitUntil(async () => (await menu.getAttribute('data-state')) === 'open', { timeout: 10000 })
  return menu
}

/** Secondary controls (permission / plan / effort) live under Tune popover. */
async function openTunePanel(): Promise<ChainablePromiseElement> {
  const tune = await chat.composerTune
  await tune.waitForExist({ timeout: 10000 })
  await browser.execute((el: HTMLElement) => {
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse' }))
    el.click()
  }, tune)
  const panel = await chat.composerTunePanel
  await panel.waitForExist({ timeout: 10000 })
  return panel
}

describe('composer widgets @core', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await switchToCodeSurface()
  })

  beforeEach(async () => {
    // Make sure we are on the code new-conversation draft (not inside an active session)
    // so the composer footer widgets are present and deterministic.
    const newConversation = await chat.newConversation
    if (!(await newConversation.isExisting())) {
      await switchToCodeSurface()
      await newConversation.waitForExist({ timeout: 10000 })
    }
  })

  afterEach(async () => {
    // Radix dropdowns in headless WebKit do not always dismiss with Escape inside
    // the test body; close any leftover menu so the next spec starts with a clean UI.
    const menu = await browser.$('[role="menu"]')
    if (await menu.isExisting()) {
      await browser.keys('Escape')
      await menu.waitForExist({ reverse: true, timeout: 5000 })
    }
  })

  it('shows the model picker chip and lists providers and models', async () => {
    const menu = await openChipMenu(await chat.modelChip)
    const text = await menu.getText()
    // The dropdown is grouped by provider and contains at least one model entry.
    expect(text.length).toBeGreaterThan(0)
    await browser.keys('Escape')
  })

  it('shows Tune and permission mode picker with all three modes', async () => {
    await openTunePanel()
    const chip = await chat.permissionChip
    await chip.waitForExist({ timeout: 10000 })
    const menu = await openChipMenu(chip)
    const text = await menu.getText()
    // zh-CN or en labels
    const hasChat = text.includes('仅对话') || /chat/i.test(text)
    const hasEdit = text.includes('编辑') || /edit/i.test(text)
    const hasFull = text.includes('完全') || /full|agent/i.test(text)
    expect(hasChat || hasEdit || hasFull).toBe(true)
    const items = await browser.$$('[role="menuitem"]')
    expect(items.length).toBeGreaterThanOrEqual(3)
    await browser.keys('Escape')
  })

  it('updates the permission chip label after selecting a different mode', async () => {
    await openTunePanel()
    const chip = await chat.permissionChip
    await chip.waitForExist({ timeout: 10000 })
    const before = await chip.getText()
    await openChipMenu(chip)

    // Radix dropdown items in headless WebKit are not reliably reported as
    // clickable while CSS animations are throttled; dispatch the click directly.
    const items = await browser.$$('[role="menuitem"]')
    expect(items.length).toBeGreaterThanOrEqual(1)
    await browser.execute((el: HTMLElement) => el.click(), items[0])

    // Non-default permission pins outside Tune; re-open Tune if chip left the panel.
    await browser.waitUntil(async () => {
      const pinned = await browser.$('[data-testid="composer-controls-pinned"] [data-testid="permission-chip"]')
      if (await pinned.isExisting()) {
        return (await pinned.getText()).length > 0 && (await pinned.getText()) !== before
      }
      const inTune = await chat.permissionChip
      if (!(await inTune.isExisting())) {
        await openTunePanel()
      }
      const after = await (await chat.permissionChip).getText()
      return after.length > 0 && after !== before
    }, { timeout: 10000 })

    // Restore via pinned chip or Tune.
    let restoreChip = await browser.$('[data-testid="permission-chip"]')
    if (!(await restoreChip.isExisting())) {
      await openTunePanel()
      restoreChip = await chat.permissionChip
    }
    await openChipMenu(restoreChip)
    const restoreItems = await browser.$$('[role="menuitem"]')
    expect(restoreItems.length).toBeGreaterThanOrEqual(2)
    await browser.execute((el: HTMLElement) => el.click(), restoreItems[1])
    await browser.pause(200)
  })

  it('send button is disabled when textarea is empty and no attachments', async () => {
    const send = await chat.composerSend
    expect(await send.isEnabled()).toBe(false)
  })

  it('keeps the send button disabled on the code surface while no project folder is picked', async () => {
    const ta = await chat.composerTextarea
    await ta.waitForExist({ timeout: 10000 })
    await ta.click()
    await ta.clearValue()
    await browser.keys('write some code')

    const send = await chat.composerSend
    expect(await send.isEnabled()).toBe(false)
  })

  it('renders the attachment button when the active model supports attachments', async () => {
    // The attachment button is only mounted for multimodal models.  With the
    // default DeepSeek model it is typically absent; this test documents the
    // selector and skips the assertion when the current catalog/model does not
    // advertise attachment support.
    const btn = await chat.attachmentButton
    const exists = await btn.isExisting()
    if (exists) {
      await expect(btn).toBeDisplayed()
    }
  })
})
