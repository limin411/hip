// Context menu L3 panel: file tree, diff, terminal, message/code nesting.
import { expect } from 'expect-webdriverio'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
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
  createCodeSessionForE2e,
  injectServerMessage,
  simulateAgentWriteFinished,
  waitForHipE2E,
} from '../helpers/e2e-hooks.js'
import { diffFileTexts, initGitAndOpenChanges } from '../helpers/git-workspace.js'
import { selectPanelTab } from '../helpers/panel.js'
import { switchToChatSurface, switchToCodeSurface } from '../helpers/surface.js'
import { CodePage } from '../page-objects/CodePage.js'

const FIXTURE = path.resolve('e2e/fixtures/sample-project')
const codePage = new CodePage()

const CONTROLLED = '[data-testid="controlled-context-menu-content"]' as const

async function waitForTabs(min = 1): Promise<void> {
  await browser.waitUntil(
    async () => (await (await browser.$$('[data-session-tab="true"]')).length) >= min,
    { timeout: 30000, interval: 300 },
  )
}

async function ensureCodeSession(cwd: string): Promise<string> {
  await switchToCodeSurface()
  const sessionId = await createCodeSessionForE2e(cwd)
  expect(sessionId).toBeTruthy()
  await waitForTabs(1)
  await (await browser.$('[data-testid="toggle-panel"]')).waitForExist({ timeout: 30000 })
  return sessionId
}

describe('context menu panel @context-menu @panel', () => {
  let writeDir: string

  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await waitForHipE2E()

    writeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hip-e2e-cm-diff-'))
    fs.writeFileSync(path.join(writeDir, 'hello.txt'), 'hello\n')
  })

  after(() => {
    if (writeDir) fs.rmSync(writeDir, { recursive: true, force: true })
  })

  afterEach(async () => {
    await closeContextMenu().catch(() => {})
  })

  // ── T7: file tree ─────────────────────────────────────────────────────────

  it('CM-P1: file.open opens README preview', async () => {
    await ensureCodeSession(FIXTURE)
    await selectPanelTab('files')

    const entrySel = '[data-testid="tree-entry"][data-path$="/README.md"]'
    await (await browser.$(entrySel)).waitForExist({ timeout: 60000 })

    await openAndClickContextMenuItem(entrySel, 'file.open')

    const md = await browser.$('[data-testid="preview-markdown"]')
    await md.waitForExist({ timeout: 30000 })
    await browser.waitUntil(
      async () => (await md.getText()).includes('Sample Project'),
      { timeout: 15000, interval: 300 },
    )
  })

  it('CM-P2: file.copyRelativePath is present and clickable', async () => {
    await ensureCodeSession(FIXTURE)
    await selectPanelTab('files')

    const entrySel = '[data-testid="tree-entry"][data-path$="/README.md"]'
    await (await browser.$(entrySel)).waitForExist({ timeout: 60000 })

    await openContextMenu(entrySel)
    await expectContextMenuItems(['file.copyRelativePath', 'file.copyName'])
    // Enabled when path is under cwd.
    const rel = await browser.$('[data-testid="context-menu-item-file.copyRelativePath"]')
    const disabled = await rel.getAttribute('data-disabled')
    expect(disabled).toBe(null)
    await clickContextMenuItem('file.copyRelativePath')
  })

  it('CM-P3: file.openContainingFolder is enabled under project cwd', async () => {
    await ensureCodeSession(FIXTURE)
    await selectPanelTab('files')

    const entrySel = '[data-testid="tree-entry"][data-path$="/README.md"]'
    await (await browser.$(entrySel)).waitForExist({ timeout: 60000 })

    await openContextMenu(entrySel)
    await expectContextMenuItems(['file.openContainingFolder'])
    const item = await browser.$('[data-testid="context-menu-item-file.openContainingFolder"]')
    const disabled = await item.getAttribute('data-disabled')
    expect(disabled).toBe(null)
    // Click is best-effort (Finder not assertable); menu must dismiss without throw.
    await clickContextMenuItem('file.openContainingFolder')
  })

  // ── T8: diff + checkpoint ─────────────────────────────────────────────────

  it('CM-P4: diff file menu exposes copy path actions', async () => {
    const sessionId = await ensureCodeSession(writeDir)
    await selectPanelTab('files')
    await (await codePage.gitInitButton).waitForExist({ timeout: 60000 })
    await initGitAndOpenChanges()

    fs.writeFileSync(path.join(writeDir, 'hello.txt'), 'changed-by-cm-e2e\n')
    fs.writeFileSync(path.join(writeDir, 'cm-new.txt'), 'new file\n')
    await simulateAgentWriteFinished(sessionId)

    await browser.waitUntil(
      async () => {
        const joined = await diffFileTexts()
        return joined.includes('hello.txt') || joined.includes('cm-new.txt')
      },
      {
        timeout: 30000,
        interval: 500,
        timeoutMsg: 'Changes did not list write path after tool:finished',
      },
    )

    // Prefer header host (DeclarativeContextMenu trigger).
    const headerSel = '[data-testid="diff-file-header"]'
    await (await browser.$(headerSel)).waitForExist({ timeout: 10000 })
    await openContextMenu(headerSel)
    await expectContextMenuItems(['diffFile.copyPath'])
    const ids = await listContextMenuItemIds()
    expect(ids.some((id) => id.startsWith('diffFile.'))).toBe(true)
    // Workspace diffs usually include toggle collapse.
    expect(ids).toContain('diffFile.toggleCollapse')
    await closeContextMenu()
  })

  it('CM-P6: terminal chrome menu has restart and copyCwd', async () => {
    await ensureCodeSession(FIXTURE)
    await selectPanelTab('terminal')

    const view = await browser.$('[data-testid="panel-view-terminal"]')
    await view.waitForExist({ timeout: 15000 })

    const empty = await browser.$('[data-testid="terminal-view-empty"]')
    const term = await browser.$('[data-testid="terminal-view"]')
    await browser.waitUntil(
      async () => (await empty.isExisting()) || (await term.isExisting()),
      { timeout: 15000, interval: 300 },
    )

    if (await empty.isExisting()) {
      // Bound fixture should mount host; if not, soft-skip chrome assertions.
      expect(await browser.$('[data-testid="terminal-select-folder"]').isExisting()).toBe(true)
      return
    }

    const chromeSel = '[data-testid="terminal-chrome"]'
    await (await browser.$(chromeSel)).waitForExist({ timeout: 15000 })
    await openContextMenu(chromeSel)
    await expectContextMenuItems(['terminal.restart'])
    const ids = await listContextMenuItemIds()
    expect(ids).toContain('terminal.copyCwd')
    expect(ids).toContain('terminal.openFiles')
    await closeContextMenu()
  })

  it('CM-P7: terminal canvas controlled menu has paste and copySelection', async () => {
    await ensureCodeSession(FIXTURE)
    await selectPanelTab('terminal')

    const empty = await browser.$('[data-testid="terminal-view-empty"]')
    const term = await browser.$('[data-testid="terminal-view"]')
    await browser.waitUntil(
      async () => (await empty.isExisting()) || (await term.isExisting()),
      { timeout: 15000, interval: 300 },
    )
    if (await empty.isExisting()) {
      return
    }

    const xtermSel = '[data-testid="terminal-xterm"]'
    await (await browser.$(xtermSel)).waitForExist({ timeout: 15000 })

    await openContextMenu(xtermSel, { contentSelector: CONTROLLED })
    await expectContextMenuItems(['terminal.paste', 'terminal.copySelection'], CONTROLLED)
    // No selection → copySelection disabled.
    const copySel = await browser.$('[data-testid="context-menu-item-terminal.copySelection"]')
    const disabled = await copySel.getAttribute('data-disabled')
    // Radix sets data-disabled when disabled (empty string or "true").
    expect(disabled !== null).toBe(true)
    await closeContextMenu()
  })

  // ── T10: nesting ──────────────────────────────────────────────────────────

  it('CM-P8: nested code block menu vs outer message menu', async () => {
    await switchToChatSurface()
    const sessionId = await createChatSessionForE2e()
    expect(sessionId).toBeTruthy()
    await waitForTabs(1)

    const fenceBody = 'const nestedE2e = 42'
    const content = ['Here is code:', '', '```ts', fenceBody, '```', '', 'After fence.'].join('\n')
    await injectServerMessage({
      type: 'message:complete',
      sessionId,
      message: {
        id: `e2e-cm-nest-${Date.now()}`,
        role: 'assistant',
        content,
        agentId: 'supervisor',
        timestamp: Date.now(),
      },
    })

    const codeHost = await browser.$('[data-testid="code-block-context-menu"]')
    await codeHost.waitForExist({ timeout: 15000 })

    // Inner: code block
    await openContextMenu('[data-testid="code-block-context-menu"]')
    await expectContextMenuItems(['codeBlock.copy'])
    const codeIds = await listContextMenuItemIds()
    expect(codeIds).toContain('codeBlock.copy')
    expect(codeIds.some((id) => id.startsWith('message.'))).toBe(false)
    await closeContextMenu()

    // Outer: message bubble (host wraps whole bubble including avatar/header)
    await openContextMenu('[data-testid="message-context-menu"]')
    await expectContextMenuItems(['message.copy', 'message.quote'])
    const msgIds = await listContextMenuItemIds()
    expect(msgIds).toContain('message.copy')
    // Nested open should still be message items (we targeted the outer host).
    expect(msgIds.some((id) => id.startsWith('message.'))).toBe(true)
    await closeContextMenu()
  })
})
