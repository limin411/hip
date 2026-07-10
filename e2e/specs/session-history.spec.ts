// Phase 2 C11: session history open + toolbar smoke.
import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { createChatSessionForE2e, waitForHipE2E } from '../helpers/e2e-hooks.js'
import { closeHistory, openHistory } from '../helpers/history.js'
import { switchToChatSurface } from '../helpers/surface.js'

describe('session history @smoke @core', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await waitForHipE2E()
    await switchToChatSurface()
    // Ensure at least one session exists for list density (optional).
    await createChatSessionForE2e()
  })

  after(async () => {
    await closeHistory()
  })

  it('opens history from account menu with toolbar filters', async () => {
    await openHistory()
    const view = await browser.$('[data-testid="session-history"]')
    await view.waitForExist({ timeout: 10000 })
    expect(await view.isExisting()).toBe(true)

    const toolbar = await browser.$('[data-testid="session-history-toolbar"]')
    await toolbar.waitForExist({ timeout: 10000 })
    expect(await toolbar.isExisting()).toBe(true)
  })
})
