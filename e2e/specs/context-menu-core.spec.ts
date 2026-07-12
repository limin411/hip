// Context menu L2 core: quote, tabs (rename/close/bulk cancel), prefs, history, modal focus.
import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
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
import { openSettings, closeSettings } from '../helpers/settings.js'
import { switchToChatSurface } from '../helpers/surface.js'

const QUOTE_BODY = 'quote me for e2e composer insert'
const RENAME_TITLE = 'E2E Renamed Tab'

async function waitForSessionTabs(min = 1): Promise<number> {
  await browser.waitUntil(
    async () => (await (await browser.$$('[data-testid="session-tab"]')).length) >= min,
    { timeout: 30000, interval: 300 },
  )
  return (await browser.$$('[data-testid="session-tab"]')).length
}

async function dismissOpenModals(): Promise<void> {
  await closeContextMenu().catch(() => {})
  for (const sel of [
    '[data-testid="confirm-delete-sessions"]',
    '[data-testid="rename-session-input"]',
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
    const newBtn = await browser.$('[data-testid="new-session-button"]')
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

    await browser.waitUntil(
      async () => {
        const value = await ta.getValue()
        return value.includes('> ' + QUOTE_BODY) && value.includes('DRAFT')
      },
      {
        timeout: 10000,
        interval: 200,
        timeoutMsg: 'composer did not receive quote insert while keeping draft',
      },
    )

    const value = await ta.getValue()
    expect(value).toContain('DRAFT')
    expect(value).toContain(`> ${QUOTE_BODY}`)
  })

  it('CM-C2: session tab rename updates the tab title', async () => {
    const sessionId = await createChatSessionForE2e()
    expect(sessionId).toBeTruthy()
    await waitForSessionTabs(1)

    const hostSel = contextMenuKindSelector('sessionTab')
    await openAndClickContextMenuItem(hostSel, 'sessionTab.rename')

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
        const tabs = await browser.$$('[data-testid="session-tab"]')
        for (const tab of tabs) {
          if ((await tab.getText()).includes(RENAME_TITLE)) return true
        }
        return false
      },
      { timeout: 10000, interval: 200, timeoutMsg: 'tab title did not update after rename' },
    )
  })

  it('CM-C3: session tab close removes the tab (Path A delete)', async () => {
    await createChatSessionForE2e()
    await createChatSessionForE2e()
    const before = await waitForSessionTabs(2)
    expect(before).toBeGreaterThanOrEqual(2)

    const hostSel = contextMenuKindSelector('sessionTab')
    await openAndClickContextMenuItem(hostSel, 'sessionTab.close')

    await browser.waitUntil(
      async () => (await (await browser.$$('[data-testid="session-tab"]')).length) === before - 1,
      {
        timeout: 15000,
        interval: 200,
        timeoutMsg: `expected tab count ${before - 1} after close`,
      },
    )
  })

  it('CM-C4: multi-delete shows confirm and cancel leaves tabs unchanged', async () => {
    await createChatSessionForE2e()
    await createChatSessionForE2e()
    const before = await waitForSessionTabs(2)
    expect(before).toBeGreaterThanOrEqual(2)

    const hostSel = contextMenuKindSelector('sessionTab')
    await openContextMenu(hostSel)
    await clickContextMenuItem('sessionTab.deleteOthers')

    const confirmBtn = await browser.$('[data-testid="confirm-delete-sessions"]')
    await confirmBtn.waitForExist({ timeout: 10000 })
    expect(await confirmBtn.isExisting()).toBe(true)

    await browser.keys('Escape')
    await browser.waitUntil(
      async () => !(await (await browser.$('[data-testid="confirm-delete-sessions"]')).isExisting()),
      {
        timeout: 8000,
        interval: 100,
        timeoutMsg: 'confirm-delete-sessions still present after cancel',
      },
    )

    const after = await (await browser.$$('[data-testid="session-tab"]')).length
    expect(after).toBe(before)
  })

  it('CM-C9: canceling rename modal leaves the shell interactive', async () => {
    await createChatSessionForE2e()
    await waitForSessionTabs(1)

    const hostSel = contextMenuKindSelector('sessionTab')
    await openAndClickContextMenuItem(hostSel, 'sessionTab.rename')

    const input = await browser.$('[data-testid="rename-session-input"]')
    await input.waitForExist({ timeout: 10000 })

    await browser.keys('Escape')
    await browser.waitUntil(
      async () => !(await (await browser.$('[data-testid="rename-session-input"]')).isExisting()),
      { timeout: 8000, interval: 100 },
    )

    // Shell must remain interactive (no stuck body pointer-events after Modal + menu).
    const titlebar = await browser.$('[data-testid="titlebar"]')
    await titlebar.waitForExist({ timeout: 10000 })
    expect(await titlebar.isExisting()).toBe(true)

    await openContextMenu(hostSel)
    await expectContextMenuItems(['sessionTab.rename', 'sessionTab.close'])
    await closeContextMenu()

    // A second open after dismiss proves pointer events still work on chrome.
    await openContextMenu(hostSel)
    const ids = await listContextMenuItemIds()
    expect(ids).toContain('sessionTab.close')
    await closeContextMenu()
  })

  it('CM-C6/C7: prefs hide message.quote then reset restores it', async () => {
    const sessionId = await createChatSessionForE2e()
    expect(sessionId).toBeTruthy()
    await waitForSessionTabs(1)
    await seedAssistantMessage(sessionId, 'prefs hide quote body')

    // Ensure quote is visible before hide.
    await openContextMenu('[data-testid="message-context-menu"]')
    await expectContextMenuItems(['message.copy', 'message.quote'])
    await closeContextMenu()

    await openSettings()
    try {
      const panel = await browser.$('[data-testid="context-menu-settings"]')
      await panel.waitForExist({ timeout: 15000 })

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

    await openContextMenu('[data-testid="message-context-menu"]')
    const hiddenIds = await listContextMenuItemIds()
    expect(hiddenIds).toContain('message.copy')
    expect(hiddenIds).not.toContain('message.quote')
    await closeContextMenu()

    // Reset prefs.
    await openSettings()
    try {
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

    const newBtn = await browser.$('[data-testid="new-session-button"]')
    await newBtn.waitForExist({ timeout: 10000 })
    expect(await newBtn.isExisting()).toBe(true)
  })
})
