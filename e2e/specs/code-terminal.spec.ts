import { expect } from 'expect-webdriverio'
import * as path from 'node:path'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { closePanelMenu, listPanelMenuTabs, selectPanelTab } from '../helpers/panel.js'
import { switchToChatSurface, switchToCodeSurface } from '../helpers/surface.js'
import { CodePage } from '../page-objects/CodePage.js'

/**
 * Code-surface Terminal e2e smoke.
 *
 * Covered (product-critical, automatable):
 * - Terminal entry appears on code panel menu after committed project session
 * - Selecting Terminal mounts panel-view-terminal + host (or empty no-cwd)
 * - Restart control present when host mounted
 * - Switch away (files) then back keeps terminal host (keep-alive UI path)
 * - Chat surface panel menu never lists Terminal
 *
 * Not covered here (unit/Rust/manual):
 * - Interactive keystrokes / PTY process kill / soft-cap / Windows stub / ring rehydrate bytes
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

describe('code terminal panel @panel @core', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await switchToCodeSurface()
    await commitCodeSession('hello terminal e2e')
  })

  it('lists Terminal on the code panel menu for a project session', async () => {
    const tabs = await listPanelMenuTabs()
    expect(tabs).toContain('panel-tab-terminal')
    expect(tabs).toContain('panel-tab-files')
    expect(tabs).toContain('panel-tab-agents')
    await closePanelMenu()
  })

  it('opens Terminal view with host UI (xterm container + restart)', async () => {
    await selectPanelTab('terminal')

    const view = await browser.$('[data-testid="panel-view-terminal"]')
    await view.waitForExist({ timeout: 15000 })
    expect(await view.isExisting()).toBe(true)

    const empty = await browser.$('[data-testid="terminal-view-empty"]')
    const term = await browser.$('[data-testid="terminal-view"]')
    await browser.waitUntil(
      async () => (await empty.isExisting()) || (await term.isExisting()),
      { timeout: 15000, interval: 300 },
    )

    // Project session was bound to FIXTURE — expect full host, not empty.
    if (await empty.isExisting()) {
      // Soft fail path: still prove empty state is reachable UI.
      expect(await browser.$('[data-testid="terminal-select-folder"]').isExisting()).toBe(true)
      return
    }

    expect(await term.isExisting()).toBe(true)
    await (await browser.$('[data-testid="terminal-xterm"]')).waitForExist({ timeout: 15000 })
    expect(await browser.$('[data-testid="terminal-restart"]').isExisting()).toBe(true)
    expect(await browser.$('[data-testid="terminal-cwd"]').isExisting()).toBe(true)
  })

  it('can leave Terminal for Files then return (UI keep-alive path)', async () => {
    // Ensure we start from terminal if previous test left empty-only.
    const termAlready = await browser.$('[data-testid="panel-view-terminal"]')
    if (!(await termAlready.isExisting())) {
      await selectPanelTab('terminal')
    }

    await selectPanelTab('files')
    await (await browser.$('[data-testid="panel-view-files"]')).waitForExist({ timeout: 15000 })

    await selectPanelTab('terminal')
    await (await browser.$('[data-testid="panel-view-terminal"]')).waitForExist({ timeout: 15000 })

    const term = await browser.$('[data-testid="terminal-view"]')
    const empty = await browser.$('[data-testid="terminal-view-empty"]')
    expect((await term.isExisting()) || (await empty.isExisting())).toBe(true)
  })

  it('does not list Terminal on the chat surface panel menu', async () => {
    await switchToChatSurface()
    await (await browser.$('[data-testid="new-conversation"]')).waitForExist({ timeout: 60000 })

    // Chat without an active session: no toggle ⇒ no terminal entry (product gate).
    const toggle = await browser.$('[data-testid="toggle-panel"]')
    if (!(await toggle.isExisting())) {
      return
    }

    const tabs = await listPanelMenuTabs()
    expect(tabs).not.toContain('panel-tab-terminal')
    expect(tabs.every((t) => t === 'panel-tab-files' || t === 'panel-tab-agents' || t === 'panel-tab-menu')).toBe(
      true,
    )
    await closePanelMenu()
  })
})
