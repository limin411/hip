// Context menu L1 smoke: open menus on primary surfaces (no destructive side effects).
import { expect } from 'expect-webdriverio'
import * as path from 'node:path'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  closeContextMenu,
  contextMenuKindSelector,
  expectContextMenuItems,
  listContextMenuItemIds,
  openContextMenu,
} from '../helpers/context-menu.js'
import {
  createChatSessionForE2e,
  createCodeSessionForE2e,
  injectServerMessage,
  waitForHipE2E,
} from '../helpers/e2e-hooks.js'
import { selectPanelTab } from '../helpers/panel.js'
import { openSettings, closeSettings, openContextMenuSettingsDialog } from '../helpers/settings.js'
import { switchToChatSurface, switchToCodeSurface } from '../helpers/surface.js'

const FIXTURE = path.resolve('e2e/fixtures/sample-project')

describe('context menu smoke @context-menu @smoke @core', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await waitForHipE2E()
  })

  afterEach(async () => {
    await closeContextMenu().catch(() => {})
  })

  it('CM-S1: message menu opens with copy and quote', async () => {
    await switchToChatSurface()
    const sessionId = await createChatSessionForE2e()
    expect(sessionId).toBeTruthy()

    await browser.waitUntil(
      async () => (await (await browser.$$('[data-testid="session-tab"]')).length) >= 1,
      { timeout: 30000, interval: 300 },
    )

    const msgId = `e2e-cm-msg-${Date.now()}`
    await injectServerMessage({
      type: 'message:complete',
      sessionId,
      message: {
        id: msgId,
        role: 'assistant',
        content: 'context menu smoke hello',
        agentId: 'supervisor',
        timestamp: Date.now(),
      },
    })

    const host = await browser.$('[data-testid="message-context-menu"]')
    await host.waitForExist({ timeout: 15000 })

    await openContextMenu('[data-testid="message-context-menu"]')
    await expectContextMenuItems(['message.copy', 'message.quote'])
    const ids = await listContextMenuItemIds()
    expect(ids).toContain('message.copy')
    expect(ids).toContain('message.quote')
    await closeContextMenu()
  })

  it('CM-S2: session tab menu opens with rename and close', async () => {
    await switchToChatSurface()
    const sessionId = await createChatSessionForE2e()
    expect(sessionId).toBeTruthy()

    await browser.waitUntil(
      async () => (await (await browser.$$('[data-testid="session-tab"]')).length) >= 1,
      { timeout: 30000, interval: 300 },
    )

    const hostSel = contextMenuKindSelector('sessionTab')
    await (await browser.$(hostSel)).waitForExist({ timeout: 15000 })

    await openContextMenu(hostSel)
    await expectContextMenuItems(['sessionTab.rename', 'sessionTab.close'])
    await closeContextMenu()
  })

  it('CM-S3: file tree entry menu opens with file actions', async () => {
    await switchToCodeSurface()
    const sessionId = await createCodeSessionForE2e(FIXTURE)
    expect(sessionId).toBeTruthy()

    await browser.waitUntil(
      async () => (await (await browser.$$('[data-testid="session-tab"]')).length) >= 1,
      { timeout: 30000, interval: 300 },
    )
    await (await browser.$('[data-testid="toggle-panel"]')).waitForExist({ timeout: 30000 })
    await selectPanelTab('files')

    // tree-entry sits inside DeclarativeContextMenu trigger; contextmenu bubbles.
    const entrySel = '[data-testid="tree-entry"][data-path$="/README.md"]'
    await (await browser.$(entrySel)).waitForExist({ timeout: 60000 })

    await openContextMenu(entrySel)
    await expectContextMenuItems(['file.copyName', 'file.open'])
    const ids = await listContextMenuItemIds()
    expect(ids.some((id) => id.startsWith('file.'))).toBe(true)
    await closeContextMenu()
  })

  it('CM-S4: settings general exposes context-menu prefs via configure dialog', async () => {
    await openSettings()
    try {
      const panel = await browser.$('[data-testid="context-menu-settings"]')
      await panel.waitForExist({ timeout: 15000 })
      expect(await panel.isExisting()).toBe(true)

      await openContextMenuSettingsDialog()

      // At least one catalog row for a known kind.
      const kind = await browser.$('[data-testid="context-menu-settings-kind-message"]')
      await kind.waitForExist({ timeout: 10000 })
      const quoteRow = await browser.$('[data-testid="context-menu-settings-item-message.quote"]')
      await quoteRow.waitForExist({ timeout: 10000 })
      expect(await quoteRow.isExisting()).toBe(true)
    } finally {
      await closeSettings()
    }
  })
})
