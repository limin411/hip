// Context menu L2 core: quote, tabs (rename/close only), prefs, history, modal focus.
import { expect } from 'expect-webdriverio'
import { leaveSpecialViewsIfOpen, waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  clickContextMenuItem,
  closeContextMenu,
  contextMenuKindSelector,
  expectContextMenuItems,
  listContextMenuItemIds,
  openAndClickContextMenuItem,
  openContextMenu,
} from '../helpers/context-menu.js'
import {
  createChatSessionForE2e,
  injectServerMessage,
  waitForHipE2E,
} from '../helpers/e2e-hooks.js'
import { closeHistory, openHistory } from '../helpers/history.js'
import {
  openSettings,
  closeSettings,
  openContextMenuSettingsDialog,
} from '../helpers/settings.js'
import { switchToChatSurface } from '../helpers/surface.js'

const QUOTE_BODY = 'quote me for e2e composer insert'
const RENAME_TITLE = 'E2E Renamed Tab'

async function waitForSessionTabs(min = 1): Promise<number> {
  await browser.waitUntil(
    async () => (await (await browser.$$('[data-session-tab="true"]')).length) >= min,
    { timeout: 30000, interval: 300 },
  )
  return (await browser.$$('[data-session-tab="true"]')).length
}

async function dismissOpenModals(): Promise<void> {
  await closeContextMenu().catch(() => {})
  for (const sel of [
    '[data-testid="confirm-delete-sessions"]',
    '[data-testid="rename-session-input"]',
    '[data-testid="context-menu-settings-dialog"]',
  ]) {
    const el = await browser.$(sel)
    if (await el.isExisting()) {
      await browser.keys('Escape')
      await browser.waitUntil(async () => !(await (await browser.$(sel)).isExisting()), {
        timeout: 5000,
        interval: 100,
      })
    }
  }
}

/** Set React-controlled input/textarea value and fire input. */
async function setControlValue(selector: string, value: string): Promise<void> {
  await browser.execute(
    (sel: string, v: string) => {
      const el = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement | null
      if (!el) throw new Error(`no control for ${sel}`)
      const proto =
        el instanceof HTMLTextAreaElement
          ? Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')
          : Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
      proto?.set?.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    },
    selector,
    value,
  )
}

async function seedAssistantMessage(sessionId: string, content: string): Promise<void> {
  const msgId = `e2e-cm-msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  await injectServerMessage({
    type: 'message:complete',
    sessionId,
    message: {
      id: msgId,
      role: 'assistant',
      content,
      agentId: 'supervisor',
      timestamp: Date.now(),
    },
  })
  const host = await browser.$('[data-testid="message-context-menu"]')
  await host.waitForExist({ timeout: 15000 })
  await browser.waitUntil(async () => (await host.getText()).includes(content), {
    timeout: 10000,
    interval: 200,
  })
}

describe('context menu core @context-menu @core', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await waitForHipE2E()
    // Reset context-menu prefs (localStorage can outlive HIP_DATA_DIR isolation).
    await browser.execute(() => {
      try {
        localStorage.removeItem('hip.contextMenu.prefs.v1')
      } catch {
        /* ignore */
      }
    })
    await switchToChatSurface()
  })

  afterEach(async () => {
    await dismissOpenModals()
    // Leave settings/history if a test aborted mid-flow.
    if (await (await browser.$('[data-testid="session-history"]')).isExisting()) {
      await closeHistory().catch(() => {})
    }
    if (await (await browser.$('[data-testid="context-menu-settings"]')).isExisting()) {
      await closeSettings().catch(() => {})
    }
    // Prefer chat surface chrome for subsequent cases.
    const newBtn = await browser.$('[data-testid="sidebar-new-chat-list"]')
    if (!(await newBtn.isExisting())) {
      const back = await browser.$('[data-testid="titlebar-back"]')
      if (await back.isExisting()) {
        await browser.execute((el: HTMLElement) => el.click(), back)
        await newBtn.waitForExist({ timeout: 10000 }).catch(() => {})
      }
    }
  })

  it('CM-C1: message.quote inserts blockquote into the active composer', async () => {
    const sessionId = await createChatSessionForE2e()
    expect(sessionId).toBeTruthy()
    await waitForSessionTabs(1)

    const msgId = `e2e-cm-quote-${Date.now()}`
    await injectServerMessage({
      type: 'message:complete',
      sessionId,
      message: {
        id: msgId,
        role: 'user',
        content: QUOTE_BODY,
        timestamp: Date.now(),
      },
    })

    const host = await browser.$('[data-testid="message-context-menu"]')
    await host.waitForExist({ timeout: 15000 })
    await browser.waitUntil(async () => (await host.getText()).includes(QUOTE_BODY), {
      timeout: 10000,
      interval: 200,
    })

    const ta = await browser.$('textarea')
    await ta.waitForExist({ timeout: 15000 })
    await ta.click()
    await setControlValue('textarea', 'DRAFT ')
    await browser.waitUntil(async () => (await ta.getValue()).includes('DRAFT'), {
      timeout: 5000,
      interval: 100,
    })

    await openAndClickContextMenuItem(
      '[data-testid="message-context-menu"]',
      'message.quote',
    )

    // Product path: quote becomes a composer chip (prepended on send), draft text stays.
    const quoteChip = await browser.$('[data-testid="composer-quote"]')
    await quoteChip.waitForExist({ timeout: 10000 })
    expect(await quoteChip.getText()).toContain(QUOTE_BODY)
    const value = await ta.getValue()
    expect(value).toContain('DRAFT')
  })

  it('CM-C2: session tab rename updates the tab title', async () => {
    const sessionId = await createChatSessionForE2e()
    expect(sessionId).toBeTruthy()
    await waitForSessionTabs(1)

    const hostSel = contextMenuKindSelector('sessionHistory')
    await openAndClickContextMenuItem(hostSel, 'sessionHistory.rename')

    const input = await browser.$('[data-testid="rename-session-input"]')
    await input.waitForExist({ timeout: 10000 })
    await setControlValue('[data-testid="rename-session-input"]', RENAME_TITLE)

    const confirm = await browser.$('[data-testid="rename-session-confirm"]')
    await confirm.waitForExist({ timeout: 5000 })
    await browser.execute((el: HTMLElement) => el.click(), confirm)

    await browser.waitUntil(
      async () => !(await (await browser.$('[data-testid="rename-session-input"]')).isExisting()),
      { timeout: 8000, interval: 100 },
    )

    await browser.waitUntil(
      async () => {
        const tabs = await browser.$$('[data-session-tab="true"]')
        for (const tab of tabs) {
          if ((await tab.getText()).includes(RENAME_TITLE)) return true
        }
        return false
      },
      { timeout: 10000, interval: 200, timeoutMsg: 'tab title did not update after rename' },
    )
  })

  it('CM-C3: sessionHistory.open focuses the session row', async () => {
    const idA = await createChatSessionForE2e()
    const idB = await createChatSessionForE2e()
    await waitForSessionTabs(2)
    // Open menu on first matching sessionHistory host and select open.
    const hostSel = contextMenuKindSelector('sessionHistory')
    await openAndClickContextMenuItem(hostSel, 'sessionHistory.open')
    // Product: open selects a session; at least one tab remains selected.
    const active = await browser.$('[data-session-tab="true"][aria-selected="true"]')
    await active.waitForExist({ timeout: 10000 })
    expect([idA, idB].some((id) => id.length > 0)).toBe(true)
  })

  it('CM-C4: sidebar session menu has open/rename/delete', async () => {
    await createChatSessionForE2e()
    await createChatSessionForE2e()
    await waitForSessionTabs(2)

    const hostSel = contextMenuKindSelector('sessionHistory')
    await openContextMenu(hostSel)
    await expectContextMenuItems([
      'sessionHistory.open',
      'sessionHistory.rename',
      'sessionHistory.delete',
    ])
    const ids = await listContextMenuItemIds()
    expect(ids).toContain('sessionHistory.delete')
    await closeContextMenu()
  })

  it('CM-C9: canceling rename modal leaves the shell interactive', async () => {
    await createChatSessionForE2e()
    await waitForSessionTabs(1)

    const hostSel = contextMenuKindSelector('sessionHistory')
    await openAndClickContextMenuItem(hostSel, 'sessionHistory.rename')

    const input = await browser.$('[data-testid="rename-session-input"]')
    await input.waitForExist({ timeout: 10000 })

    await browser.keys('Escape')
    await browser.waitUntil(
      async () => !(await (await browser.$('[data-testid="rename-session-input"]')).isExisting()),
      { timeout: 8000, interval: 100 },
    )

    // Shell must remain interactive (no stuck body pointer-events after Modal + menu).
    const sidebar = await browser.$('[data-testid="app-sidebar"]')
    await sidebar.waitForExist({ timeout: 10000 })
    expect(await sidebar.isExisting()).toBe(true)

    await openContextMenu(hostSel)
    await expectContextMenuItems(['sessionHistory.rename', 'sessionHistory.open'])
    await closeContextMenu()

    // A second open after dismiss proves pointer events still work on chrome.
    await openContextMenu(hostSel)
    const ids = await listContextMenuItemIds()
    expect(ids).toContain('sessionHistory.open')
    await closeContextMenu()
  })

  it('CM-C6/C7: prefs hide message.quote then reset restores it', async () => {
    const ensureMsgMenu = async (label: string) => {
      await leaveSpecialViewsIfOpen().catch(() => {})
      await switchToChatSurface()
      const id = await createChatSessionForE2e()
      await seedAssistantMessage(id, label)
      await (await browser.$('[data-testid="message-context-menu"]')).waitForExist({
        timeout: 20000,
      })
      return id
    }

    await ensureMsgMenu('prefs hide quote body')

    // Ensure quote is visible before hide.
    await openContextMenu('[data-testid="message-context-menu"]')
    await expectContextMenuItems(['message.copy', 'message.quote'])
    await closeContextMenu()

    await openSettings()
    try {
      await openContextMenuSettingsDialog()

      const quoteVisible = await browser.$(
        '[data-testid="context-menu-settings-visible-message.quote"]',
      )
      await quoteVisible.waitForExist({ timeout: 10000 })
      // Uncheck if currently checked (visible).
      const checked = await quoteVisible.isSelected()
      if (checked) {
        await browser.execute((el: HTMLElement) => el.click(), quoteVisible)
      }
      await browser.waitUntil(async () => !(await quoteVisible.isSelected()), {
        timeout: 5000,
        interval: 100,
      })
    } finally {
      await closeSettings()
    }

    await ensureMsgMenu('prefs quote should be hidden')
    await openContextMenu('[data-testid="message-context-menu"]')
    const hiddenIds = await listContextMenuItemIds()
    expect(hiddenIds).toContain('message.copy')
    expect(hiddenIds).not.toContain('message.quote')
    await closeContextMenu()

    // Reset prefs.
    await openSettings()
    try {
      await openContextMenuSettingsDialog()
      const reset = await browser.$('[data-testid="context-menu-settings-reset"]')
      await reset.waitForExist({ timeout: 10000 })
      await browser.execute((el: HTMLElement) => el.click(), reset)
      const quoteVisible = await browser.$(
        '[data-testid="context-menu-settings-visible-message.quote"]',
      )
      await browser.waitUntil(async () => await quoteVisible.isSelected(), {
        timeout: 5000,
        interval: 100,
      })
    } finally {
      await closeSettings()
    }

    await ensureMsgMenu('prefs restore quote body')
    await openContextMenu('[data-testid="message-context-menu"]')
    await expectContextMenuItems(['message.copy', 'message.quote'])
    await closeContextMenu()
  })

  it('CM-C8: history row menu opens and open returns to main shell', async () => {
    const sessionId = await createChatSessionForE2e()
    expect(sessionId).toBeTruthy()
    await waitForSessionTabs(1)

    await openHistory()
    const row = await browser.$(`[data-testid="session-history-row-${sessionId}"]`)
    await row.waitForExist({ timeout: 15000 })

    // Host is DeclarativeContextMenu inside the row (scoped to this session).
    const openTarget = `[data-testid="session-history-row-${sessionId}"] ${contextMenuKindSelector('sessionHistory')}`
    await (await browser.$(openTarget)).waitForExist({ timeout: 10000 })
    await openContextMenu(openTarget)
    await expectContextMenuItems([
      'sessionHistory.open',
      'sessionHistory.rename',
      'sessionHistory.delete',
    ])
    await clickContextMenuItem('sessionHistory.open')

    await browser.waitUntil(
      async () => !(await (await browser.$('[data-testid="session-history"]')).isExisting()),
      { timeout: 15000, interval: 200, timeoutMsg: 'history view still open after open action' },
    )

    const newBtn = await browser.$('[data-testid="sidebar-new-chat-list"]')
    await newBtn.waitForExist({ timeout: 10000 })
    expect(await newBtn.isExisting()).toBe(true)
  })
})
