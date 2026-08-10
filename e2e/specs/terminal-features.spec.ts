import { expect } from 'expect-webdriverio'
import * as path from 'node:path'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { closePanelMenu, selectPanelTab } from '../helpers/panel.js'
import { switchToChatSurface, switchToCodeSurface } from '../helpers/surface.js'
import { CodePage } from '../page-objects/CodePage.js'

/**
 * Terminal capability smoke (P0 — spec docs/design/doc-terminal-capability-gap/).
 *
 * Covered (automatable against the debug binary + real local PTY):
 * - ⌘/Ctrl+F opens the search overlay; Esc closes it (P0.1)
 * - Typing in the search bar surfaces the match counter (P0.1)
 *
 * Not covered here (unit / manual):
 * - OSC 0/2 title chain — needs keystrokes into the real PTY; WebDriver keys
 *   double-fire characters on xterm's helper textarea in WKWebView and
 *   synthetic InputEvents are not trusted for the input→PTY hop. Covered by
 *   TerminalView.test.tsx 'OSC 0/2 title flows into terminalStore (P0.3)' +
 *   ManagedTerminalSession chrome unit tests.
 * - Bell flash timing (700ms one-shot — covered by TerminalView unit tests)
 * - Copy/paste keybindings end-to-end (clipboard permission; keymap table is unit-tested)
 * - Managed-terminal chrome title (same store field, covered via TerminalView here)
 */
const FIXTURE = path.resolve('e2e/fixtures/sample-project')
const codePage = new CodePage()

async function commitCodeSession(message: string): Promise<void> {
  await codePage.newConversation.waitForExist({ timeout: 120000 })
  await codePage.pickDirectory(FIXTURE)
  await browser.waitUntil(
    async () => {
      const chip = await codePage.folderChip.isExisting()
      const entry = await (await codePage.entry('/README.md')).isExisting()
      return chip || entry
    },
    { timeout: 60000, interval: 500 },
  )

  const ta = await browser.$('[data-testid="new-conversation"] textarea')
  await ta.waitForExist({ timeout: 10000 })
  await ta.click()
  await browser.keys(message)
  const send = await browser.$('[data-testid="new-conversation"] [data-testid="composer-send"]')
  await send.waitForEnabled({ timeout: 10000 })
  await send.click()

  await browser.waitUntil(
    async () => (await (await browser.$$('[data-session-tab="true"]')).length) >= 1,
    { timeout: 120000, interval: 500 },
  )
  await (await browser.$('[data-testid="toggle-panel"]')).waitForExist({ timeout: 30000 })
}

describe('terminal features P0 @smoke @panel', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await switchToCodeSurface()
    await commitCodeSession('terminal features e2e')
    await selectPanelTab('terminal')
    const view = await browser.$('[data-testid="panel-view-terminal"]')
    await view.waitForExist({ timeout: 15000 })
    await (await browser.$('[data-testid="terminal-xterm"]')).waitForExist({ timeout: 30000 })
  })

  it('P0.1: ⌘F opens the search bar; Esc closes it', async () => {
    await browser.keys(['Meta', 'f'])
    const bar = await browser.$('[data-testid="terminal-searchbar"]')
    await bar.waitForExist({ timeout: 5000 })
    await browser.keys('Escape')
    await bar.waitForExist({ timeout: 5000, reverse: true })
  })

  it('P0.1: typing in the search bar shows the match counter', async () => {
    await browser.keys(['Meta', 'f'])
    const input = await browser.$('[data-testid="terminal-searchbar-input"]')
    await input.waitForExist({ timeout: 5000 })
    await input.click()
    await browser.keys('README')
    const count = await browser.$('[data-testid="terminal-searchbar-count"]')
    await count.waitForExist({ timeout: 5000 })
    // Either 0/0 (no matches on screen) or n/n — the counter itself must render.
    expect(await count.getText()).toMatch(/\d+ \/ \d+/)
    await browser.keys('Escape')
  })

  // P0.3 (OSC 0/2 title → chrome badge) is deliberately NOT e2e-tested:
  // it requires driving keystrokes into the real PTY, and WebDriver keys
  // double-fire characters on xterm's helper textarea in WKWebView while
  // synthetic InputEvents are not trusted enough for the input→PTY hop.
  // The full chain is covered by unit tests:
  //   TerminalView.test.tsx > 'OSC 0/2 title flows into terminalStore (P0.3)'
  //   + ManagedTerminalSession chrome renders `store.title ?? term.title`.
})
