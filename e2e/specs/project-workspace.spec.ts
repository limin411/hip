import { expect } from 'expect-webdriverio'
import * as path from 'node:path'

const FIXTURE = path.resolve('e2e/fixtures/sample-project')
const entry = (suffix: string) => browser.$(`[data-testid="tree-entry"][data-path$="${suffix}"]`)
const sessionItems = () => browser.$$('[data-testid="session-item"]')

async function skipLoginIfPresent(): Promise<void> {
  const skip = await browser.$('button=跳过登录')
  if (await skip.isExisting()) {
    await skip.click()
    await browser.waitUntil(async () => (await browser.getUrl()).includes('#/app'), { timeout: 10000, interval: 200 })
  }
}

async function switchToCodeSurface(): Promise<void> {
  // The folder picker only exists in the code surface. The rail uses an aria-label
  // equal to the localized "代码" label (default locale is zh-CN).
  const codeBtn = await browser.$('[aria-label="代码"]')
  await codeBtn.waitForClickable({ timeout: 10000 })
  await codeBtn.click()
  await (await browser.$('[data-testid="new-conversation"]')).waitForExist({ timeout: 30000 })
}

describe('new conversation', () => {
  before(async () => {
    await browser.pause(2500)
    await skipLoginIfPresent()
    // Seam: native folder dialog can't be driven by wdio — return the fixture path.
    await browser.execute((dir: string) => {
      ;(window as unknown as { __hipPickDir?: () => Promise<string> }).__hipPickDir = () => Promise.resolve(dir)
    }, FIXTURE)
    await switchToCodeSurface()
  })

  it('a new code conversation shows the centered composer landing with a folder picker', async () => {
    // The sidecar cold-starts on first launch; wsClient buffers sends until connected,
    // so we wait generously for the first paint.
    await (await browser.$('[data-testid="new-conversation"]')).waitForExist({ timeout: 120000 })
    expect(await (await browser.$('[data-testid="pick-folder"]')).isExisting()).toBe(true)
  })

  it('picking a folder opens the tree without creating a sidebar row', async () => {
    const before = await (await sessionItems()).length
    await (await browser.$('[data-testid="pick-folder"]')).click()
    await (await entry('/README.md')).waitForExist({ timeout: 60000 })
    expect(await (await sessionItems()).length).toBe(before) // still a draft — no row
  })

  it('the composer chip ✕ returns to pure-chat (then re-pick restores the tree)', async () => {
    await (await browser.$('[data-testid="clear-folder"]')).click()
    // The default pick affordance reappears → we are back in chat mode.
    await (await browser.$('[data-testid="pick-folder"]')).waitForExist({ timeout: 10000 })
    // Restore project mode for the preview tests that follow.
    await (await browser.$('[data-testid="pick-folder"]')).click()
    await (await entry('/README.md')).waitForExist({ timeout: 60000 })
  })

  it('the Files-panel exit returns the tree to sandbox-pending (then re-pick restores it)', async () => {
    await (await browser.$('[data-testid="tree-back-to-chat"]')).click()
    // The tree entries are gone (chat-mode draft → "沙箱待创建" placeholder).
    await browser.waitUntil(async () => !(await (await entry('/README.md')).isExisting()), { timeout: 10000, interval: 200 })
    // Restore project mode for the preview tests that follow.
    await (await browser.$('[data-testid="pick-folder"]')).click()
    await (await entry('/README.md')).waitForExist({ timeout: 60000 })
  })

  it('renders a Markdown preview (rendered, not source)', async () => {
    await (await entry('/README.md')).click()
    const md = await browser.$('[data-testid="preview-markdown"]')
    await md.waitForExist({ timeout: 30000 })
    await browser.waitUntil(async () => (await md.getText()).includes('Sample Project'), { timeout: 10000, interval: 500 })
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
    await browser.waitUntil(async () => ((await img.getAttribute('src')) ?? '').includes('data:image/png;base64,'), { timeout: 10000, interval: 500 })
  })

  it('lazily expands a directory and previews a text file', async () => {
    await (await entry('/src')).click()
    await (await entry('/a.ts')).waitForExist({ timeout: 30000 })
    await (await entry('/a.ts')).click()
    const txt = await browser.$('[data-testid="preview-text"]')
    await txt.waitForExist({ timeout: 30000 })
    await browser.waitUntil(async () => (await txt.getText()).includes('export const a'), { timeout: 10000, interval: 500 })
  })

  it('sending the first message commits the session and replaces the landing', async () => {
    const before = await (await sessionItems()).length
    // Focus + browser.keys (not setValue, whose clearValue() desyncs a React-controlled
    // textarea and can leave draft.text empty). Waiting for the send button to enable
    // confirms the composer's onChange propagated to the draft store.
    const ta = await browser.$('[data-testid="new-conversation"] textarea')
    await ta.click()
    await browser.keys('hello world')
    const send = await browser.$('[data-testid="new-conversation"] [data-testid="composer-send"]')
    await send.waitForEnabled({ timeout: 10000 })
    await send.click()
    // Landing disappears (a committed session is now active)…
    await (await browser.$('[data-testid="new-conversation"]')).waitForExist({ reverse: true, timeout: 30000 })
    // …and exactly one sidebar row appears.
    await browser.waitUntil(async () => await (await sessionItems()).length === before + 1, { timeout: 30000, interval: 500 })
  })
})
