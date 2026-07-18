import { expect } from 'expect-webdriverio'
import * as path from 'node:path'
import { leaveSpecialViewsIfOpen, waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { createCodeSessionForE2e, waitForHipE2E } from '../helpers/e2e-hooks.js'
import { selectPanelTab } from '../helpers/panel.js'
import { switchToCodeSurface } from '../helpers/surface.js'
import { CodePage } from '../page-objects/CodePage.js'

const FIXTURE = path.resolve('e2e/fixtures/sample-project')
const codePage = new CodePage()
const sessionItems = () => browser.$$('[data-session-tab="true"]')

describe('new conversation @core', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
    await waitForHipE2E()
    await switchToCodeSurface()
  })

  it('shows the centered composer landing with a folder picker', async () => {
    await codePage.newConversation.waitForExist({ timeout: 120000 })
    expect(await codePage.pickFolder.isExisting()).toBe(true)
  })

  it('picking a folder sets the folder chip without creating a session tab', async () => {
    // Product: FolderPill sets draft cwd only; FileTree is in ArtifactPanel after a session.
    const before = await (await sessionItems()).length
    await codePage.pickDirectory(FIXTURE)
    await codePage.folderChip.waitForExist({ timeout: 30000 })
    expect(await codePage.folderChip.getText()).toContain(path.basename(FIXTURE))
    expect(await (await sessionItems()).length).toBe(before)
  })

  it('displays the selected folder as a chip with change and clear actions', async () => {
    await codePage.folderChip.waitForExist({ timeout: 10000 })
    expect(await codePage.folderChip.getText()).toContain(path.basename(FIXTURE))
    expect(await codePage.changeFolder.isExisting()).toBe(true)
    expect(await codePage.clearFolder.isExisting()).toBe(true)
  })

  it('clearing the folder returns to the folder picker', async () => {
    await codePage.clearFolder.click()
    await codePage.pickFolder.waitForExist({ timeout: 10000 })
    await codePage.pickDirectory(FIXTURE)
    await codePage.folderChip.waitForExist({ timeout: 30000 })
  })

  it('after code session + Files panel, tree shows fixture entries and back-to-chat is draft-only', async () => {
    const sessionId = await createCodeSessionForE2e(FIXTURE)
    expect(sessionId).toBeTruthy()
    await browser.waitUntil(
      async () => (await (await sessionItems()).length) >= 1,
      { timeout: 30000, interval: 300 },
    )
    await (await browser.$('[data-testid="toggle-panel"]')).waitForExist({ timeout: 30000 })
    await selectPanelTab('files')
    await (await browser.$('[data-testid="panel-view-files"]')).waitForExist({ timeout: 15000 })
    await (await codePage.entry('/README.md')).waitForExist({ timeout: 60000 })
    // tree-back-to-chat is draft-only; committed sessions use refresh / change folder instead.
    expect(await (await codePage.treeBackToChat).isExisting()).toBe(false)
  })

  it('renders a Markdown preview (rendered, not source)', async () => {
    await (await codePage.entry('/README.md')).click()
    const md = await browser.$('[data-testid="preview-markdown"]')
    await md.waitForExist({ timeout: 30000 })
    await browser.waitUntil(
      async () => (await md.getText()).includes('Sample Project'),
      { timeout: 10000, interval: 500 },
    )
  })

  it('renders HTML in a sandboxed iframe', async () => {
    await (await codePage.entry('/index.html')).click()
    const frame = await browser.$('[data-testid="preview-html"]')
    await frame.waitForExist({ timeout: 30000 })
    expect(await frame.getAttribute('sandbox')).toBe('')
  })

  it('renders an image as a data URL', async () => {
    await (await codePage.entry('/logo.png')).click()
    const img = await browser.$('[data-testid="preview-image"] img')
    await img.waitForExist({ timeout: 30000 })
    await browser.waitUntil(
      async () => ((await img.getAttribute('src')) ?? '').includes('data:image/png;base64,'),
      { timeout: 10000, interval: 500 },
    )
  })

  it('lazily expands a directory and previews a text file', async () => {
    await (await codePage.entry('/src')).click()
    await (await codePage.entry('/a.ts')).waitForExist({ timeout: 30000 })
    await (await codePage.entry('/a.ts')).click()
    const txt = await browser.$('[data-testid="preview-text"]')
    await txt.waitForExist({ timeout: 30000 })
    await browser.waitUntil(
      async () => (await txt.getText()).includes('export const a'),
      { timeout: 10000, interval: 500 },
    )
  })

  it('sending the first message commits the session and replaces the landing', async () => {
    await switchToCodeSurface()
    await codePage.newConversation.waitForExist({ timeout: 60000 })
    const before = await (await sessionItems()).length
    await codePage.pickDirectory(FIXTURE)
    await codePage.folderChip.waitForExist({ timeout: 30000 })
    const ta = await browser.$('[data-testid="new-conversation"] textarea')
    await ta.click()
    await browser.keys('hello world')
    const send = await browser.$('[data-testid="new-conversation"] [data-testid="composer-send"]')
    await send.waitForEnabled({ timeout: 10000 })
    await send.click()
    await codePage.newConversation.waitForExist({ reverse: true, timeout: 30000 })
    expect(await (await sessionItems()).length).toBeGreaterThan(before)
  })
})
