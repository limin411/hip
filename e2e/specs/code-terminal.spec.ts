import { expect } from 'expect-webdriverio'
import * as path from 'node:path'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { switchToChatSurface, switchToCodeSurface } from '../helpers/surface.js'
import { CodePage } from '../page-objects/CodePage.js'

/**
 * Smoke: code-surface Terminal tab is reachable after a project session exists.
 * Does not assert interactive PTY typing (hard in e2e); verifies gate + shell UI.
 */
const FIXTURE = path.resolve('e2e/fixtures/sample-project')
const codePage = new CodePage()

async function openPanelTab(tab: string): Promise<void> {
  const toggle = await browser.$('[data-testid="toggle-panel"]')
  await toggle.waitForExist({ timeout: 30000 })
  await browser.execute((el: HTMLElement) => el.click(), toggle)
  const item = await browser.$(`[data-testid="panel-tab-${tab}"]`)
  await item.waitForExist({ timeout: 10000 })
  await browser.execute((el: HTMLElement) => el.click(), item)
}

describe('code terminal panel', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await switchToCodeSurface()
  })

  it('exposes Terminal in the code panel menu after a project session is created', async () => {
    await codePage.newConversation.waitForExist({ timeout: 120000 })
    await codePage.pickDirectory(FIXTURE)

    // Match project-workspace: wait for tree OR folder chip before proceeding.
    await browser.waitUntil(
      async () => {
        const chip = await codePage.folderChip.isExisting()
        const entry = await (await codePage.entry('/README.md')).isExisting()
        return chip || entry
      },
      { timeout: 60000, interval: 500 },
    )

    // Create a committed code session (terminal requires activeSession).
    const ta = await browser.$('[data-testid="new-conversation"] textarea')
    await ta.waitForExist({ timeout: 10000 })
    await ta.click()
    await browser.keys('hello terminal e2e')
    const send = await browser.$('[data-testid="new-conversation"] [data-testid="composer-send"]')
    await send.waitForEnabled({ timeout: 10000 })
    await send.click()

    await browser.waitUntil(
      async () => (await (await browser.$$('[data-testid="session-tab"]')).length) >= 1,
      { timeout: 120000, interval: 500 },
    )

    // Panel toggle only appears with an active session.
    await openPanelTab('terminal')

    const view = await browser.$('[data-testid="panel-view-terminal"]')
    await view.waitForExist({ timeout: 30000 })
    expect(await view.isExisting()).toBe(true)

    const empty = await browser.$('[data-testid="terminal-view-empty"]')
    const term = await browser.$('[data-testid="terminal-view"]')
    await browser.waitUntil(
      async () => (await empty.isExisting()) || (await term.isExisting()),
      { timeout: 15000, interval: 300 },
    )

    if (await term.isExisting()) {
      expect(await browser.$('[data-testid="terminal-xterm"]').isExisting()).toBe(true)
      expect(await browser.$('[data-testid="terminal-restart"]').isExisting()).toBe(true)
    }
  })

  it('does not expose Terminal on the chat surface panel menu', async () => {
    await switchToChatSurface()
    await (await browser.$('[data-testid="new-conversation"]')).waitForExist({ timeout: 60000 })

    const toggle = await browser.$('[data-testid="toggle-panel"]')
    if (!(await toggle.isExisting())) {
      // No panel without session ⇒ no terminal entry.
      return
    }
    await browser.execute((el: HTMLElement) => el.click(), toggle)
    const menu = await browser.$('[data-testid="panel-tab-menu"]')
    await menu.waitForExist({ timeout: 10000 })
    const terminalItem = await browser.$('[data-testid="panel-tab-terminal"]')
    expect(await terminalItem.isExisting()).toBe(false)
  })
})
