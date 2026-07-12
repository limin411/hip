// Context menu L2 core: quote insert + bulk multi-delete cancel (Path A).
import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  clickContextMenuItem,
  closeContextMenu,
  contextMenuKindSelector,
  openAndClickContextMenuItem,
  openContextMenu,
} from '../helpers/context-menu.js'
import {
  createChatSessionForE2e,
  injectServerMessage,
  waitForHipE2E,
} from '../helpers/e2e-hooks.js'
import { switchToChatSurface } from '../helpers/surface.js'

const QUOTE_BODY = 'quote me for e2e composer insert'

describe('context menu core @context-menu @core', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await waitForHipE2E()
    await switchToChatSurface()
  })

  afterEach(async () => {
    await closeContextMenu().catch(() => {})
    // Dismiss any leftover modals (rename / confirm delete).
    const confirm = await browser.$('[data-testid="confirm-delete-sessions"]')
    if (await confirm.isExisting()) {
      await browser.keys('Escape')
      await browser.waitUntil(async () => !(await (await browser.$('[data-testid="confirm-delete-sessions"]')).isExisting()), {
        timeout: 5000,
        interval: 100,
      })
    }
    const rename = await browser.$('[data-testid="rename-session-input"]')
    if (await rename.isExisting()) {
      await browser.keys('Escape')
      await browser.waitUntil(async () => !(await (await browser.$('[data-testid="rename-session-input"]')).isExisting()), {
        timeout: 5000,
        interval: 100,
      })
    }
  })

  it('CM-C1: message.quote inserts blockquote into the active composer', async () => {
    const sessionId = await createChatSessionForE2e()
    expect(sessionId).toBeTruthy()

    await browser.waitUntil(
      async () => (await (await browser.$$('[data-testid="session-tab"]')).length) >= 1,
      { timeout: 30000, interval: 300 },
    )

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

    // Seed a draft prefix so we prove insert (not full replace).
    const ta = await browser.$('textarea')
    await ta.waitForExist({ timeout: 15000 })
    await ta.click()
    // React-controlled InputBar: synthesise input so value state updates reliably.
    await browser.execute(() => {
      const el = document.querySelector('textarea') as HTMLTextAreaElement | null
      if (!el) throw new Error('no textarea')
      const proto = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')
      proto?.set?.call(el, 'DRAFT ')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.focus()
      const caret = el.value.length
      try {
        el.setSelectionRange(caret, caret)
      } catch {
        // ignore
      }
    })
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

  it('CM-C4: multi-delete shows confirm and cancel leaves tabs unchanged', async () => {
    // Need ≥2 open tabs so deleteOthers is enabled.
    const id1 = await createChatSessionForE2e()
    const id2 = await createChatSessionForE2e()
    expect(id1).toBeTruthy()
    expect(id2).toBeTruthy()

    await browser.waitUntil(
      async () => (await (await browser.$$('[data-testid="session-tab"]')).length) >= 2,
      { timeout: 30000, interval: 300 },
    )

    const before = await (await browser.$$('[data-testid="session-tab"]')).length
    expect(before).toBeGreaterThanOrEqual(2)

    const hostSel = contextMenuKindSelector('sessionTab')
    await (await browser.$(hostSel)).waitForExist({ timeout: 15000 })

    await openContextMenu(hostSel)
    // With ≥2 tabs, deleteOthers is enabled and opens ConfirmDeleteSessionsDialog.
    await clickContextMenuItem('sessionTab.deleteOthers')

    // Confirm dialog must appear (Path A bulk delete).
    const confirmBtn = await browser.$('[data-testid="confirm-delete-sessions"]')
    await confirmBtn.waitForExist({ timeout: 10000 })
    expect(await confirmBtn.isExisting()).toBe(true)

    // Cancel via Escape (i18n-safe; Modal onOpenChange → onCancel).
    await browser.keys('Escape')
    await browser.waitUntil(async () => !(await (await browser.$('[data-testid="confirm-delete-sessions"]')).isExisting()), {
      timeout: 8000,
      interval: 100,
      timeoutMsg: 'confirm-delete-sessions still present after cancel',
    })

    const after = await (await browser.$$('[data-testid="session-tab"]')).length
    expect(after).toBe(before)
  })
})

