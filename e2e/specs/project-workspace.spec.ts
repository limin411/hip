import { expect } from 'expect-webdriverio'
import * as path from 'node:path'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { switchToCodeSurface } from '../helpers/surface.js'
import { CodePage } from '../page-objects/CodePage.js'

const FIXTURE = path.resolve('e2e/fixtures/sample-project')
const codePage = new CodePage()
const sessionItems = () => browser.$$('[data-testid="session-item"]')
const entry = (suffix: string) => browser.$(`[data-testid="tree-entry"][data-path$="${suffix}"]`)

describe('new conversation', () => {
  before(async () => {
    await skipLoginIfPresent()
    await switchToCodeSurface()
  })

  it('a new code conversation shows the centered composer landing with a folder picker', async () => {
    await codePage.newConversation.waitForExist({ timeout: 120000 })
    expect(await codePage.pickFolder.isExisting()).toBe(true)
  })

  it('picking a folder opens the tree without creating a sidebar row', async () => {
    const before = await (await sessionItems()).length
    await codePage.pickDirectory(FIXTURE)
    await (await entry('/README.md')).waitForExist({ timeout: 60000 })
    expect(await (await sessionItems()).length).toBe(before)
  })

  it('the composer chip ✕ returns to pure-chat (then re-pick restores the tree)', async () => {
    await (await browser.$('[data-testid="clear-folder"]')).click()
    await codePage.pickFolder.waitForExist({ timeout: 10000 })
    await codePage.pickDirectory(FIXTURE)
    await (await entry('/README.md')).waitForExist({ timeout: 60000 })
  })

  it('the Files-panel exit returns the tree to sandbox-pending (then re-pick restores it)', async () => {
    await (await browser.$('[data-testid="tree-back-to-chat"]')).click()
    await browser.waitUntil(
      async () => !(await (await entry('/README.md')).isExisting()),
      { timeout: 10000, interval: 200 }
    )
    await codePage.pickDirectory(FIXTURE)
    await (await entry('/README.md')).waitForExist({ timeout: 60000 })
  })

  it('renders a Markdown preview (rendered, not source)', async () => {
    await (await entry('/README.md')).click()
    const md = await browser.$('[data-testid="preview-markdown"]')
    await md.waitForExist({ timeout: 30000 })
    await browser.waitUntil(
      async () => (await md.getText()).includes('Sample Project'),
      { timeout: 10000, interval: 500 }
    )
  })

  it('renders HTML in a sandboxed iframe', async () => {
    await (await entry('/index.html')).click()
    const frame = await browser.$('[data-testid="preview-html"]')
    await frame.waitForExist({ timeout: 30000 })
    expect(await frame.getAttribute('sandbox')).toBe('')
  })

  it('renders an image as a data URL', async () => {
    await (await entry('/logo.png')).click()
    const img = await browser.$('[data-testid="preview-image"] img')
    await img.waitForExist({ timeout: 30000 })
    await browser.waitUntil(
      async () => ((await img.getAttribute('src')) ?? '').includes('data:image/png;base64,'),
      { timeout: 10000, interval: 500 }
    )
  })

  it('lazily expands a directory and previews a text file', async () => {
    await (await entry('/src')).click()
    await (await entry('/a.ts')).waitForExist({ timeout: 30000 })
    await (await entry('/a.ts')).click()
    const txt = await browser.$('[data-testid="preview-text"]')
    await txt.waitForExist({ timeout: 30000 })
    await browser.waitUntil(
      async () => (await txt.getText()).includes('export const a'),
      { timeout: 10000, interval: 500 }
    )
  })

  it('sending the first message commits the session and replaces the landing', async () => {
    const before = await (await sessionItems()).length
    const ta = await browser.$('[data-testid="new-conversation"] textarea')
    await ta.click()
    await browser.keys('hello world')
    const send = await browser.$('[data-testid="new-conversation"] [data-testid="composer-send"]')
    await send.waitForEnabled({ timeout: 10000 })
    await send.click()
    await codePage.newConversation.waitForExist({ reverse: true, timeout: 30000 })
    await browser.waitUntil(
      async () => await (await sessionItems()).length === before + 1,
      { timeout: 30000, interval: 500 }
    )
  })
})
