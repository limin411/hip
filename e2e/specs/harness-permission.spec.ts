// Phase 2 H5: permission modal via inject (no LLM).
import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  createChatSessionForE2e,
  simulatePermissionRequest,
  waitForHipE2E,
} from '../helpers/e2e-hooks.js'
import { switchToChatSurface } from '../helpers/surface.js'
import { ChatPage } from '../page-objects/ChatPage.js'

const chat = new ChatPage()

describe('harness permission modal @harness @smoke', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await waitForHipE2E()
    // Leave special views (settings/history) if a prior suite left them open.
    const back = await browser.$('[data-testid="titlebar-back"]')
    if (await back.isExisting()) {
      await browser.execute((el: HTMLElement) => el.click(), back)
      await browser.pause(200)
    }
    // createChatSessionForE2e does not require chat surface draft; skip flaky menu switch when already on app.
    try {
      await switchToChatSurface()
    } catch {
      // Shared app may already be on chat with open sessions — continue.
    }
  })

  it('shows permission modal and dismisses after choosing an option', async () => {
    const sessionId = await createChatSessionForE2e()
    expect(sessionId).toBeTruthy()

    const { requestId } = await simulatePermissionRequest(sessionId)
    expect(requestId).toMatch(/^e2e-perm-/)

    const modal = await chat.permissionModal
    await modal.waitForExist({ timeout: 15000 })
    expect(await modal.getText()).toContain('e2e-run-script')

    const allow = await chat.permissionOption('allow_once')
    await allow.waitForExist({ timeout: 5000 })
    await browser.execute((el: HTMLElement) => el.click(), allow)

    await browser.waitUntil(async () => !(await (await chat.permissionModal).isExisting()), {
      timeout: 10000,
      interval: 200,
      timeoutMsg: 'permission-modal still open after allow',
    })
  })
})
