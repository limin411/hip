// Smoothness P0: baseline shell + chat/code session hooks (unpaid).
import { expect } from 'expect-webdriverio'
import * as path from 'node:path'
import { leaveSpecialViewsIfOpen, waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  createChatSessionForE2e,
  createCodeSessionForE2e,
  waitForHipE2E,
} from '../helpers/e2e-hooks.js'

const FIXTURE = path.resolve('e2e/fixtures/sample-project')

describe('smooth P0 baseline @smooth-p0 @smoke', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
    await waitForHipE2E()
  })

  it('P0-E1 cold launch has shell', async () => {
    const sidebar = await browser.$('[data-testid="app-sidebar"]')
    const toolbar = await browser.$('[data-testid="main-toolbar"]')
    expect((await sidebar.isExisting()) || (await toolbar.isExisting())).toBe(true)
  })

  it('P0-E2 creates chat sandbox session via harness', async () => {
    // Harness create* selects the session without needing the new-session menu.
    const id = await createChatSessionForE2e()
    expect(id).toBeTruthy()
  })

  it('P0-E3 creates code/project session with cwd', async () => {
    const id = await createCodeSessionForE2e(FIXTURE)
    expect(id).toBeTruthy()
    // Sidebar lists sessions as sidebar-session-<id> (title-bar tabs no longer use session-tab).
    const row = await browser.$(`[data-testid="sidebar-session-${id}"]`)
    await row.waitForExist({ timeout: 15000 })
  })

  it('P0-E4 app remains usable after dual session create', async () => {
    await createChatSessionForE2e()
    await createCodeSessionForE2e(FIXTURE)
    const shell = await browser.$('[data-testid="app-sidebar"]')
    expect(await shell.isExisting()).toBe(true)
  })
})
