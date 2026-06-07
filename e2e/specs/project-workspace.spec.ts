import { expect } from 'expect-webdriverio'
import * as path from 'node:path'

const FIXTURE = path.resolve('e2e/fixtures/sample-project')
const entry = (suffix: string) => browser.$(`[data-testid="tree-entry"][data-path$="${suffix}"]`)

describe('project workspace', () => {
  before(async () => {
    await browser.pause(2500)
    const skip = await browser.$('button=跳过登录')
    if (await skip.isExisting()) {
      await browser.execute((el: HTMLElement) => el.click(), (await skip) as unknown as HTMLElement)
      await browser.waitUntil(async () => (await browser.getUrl()).includes('#/app'), { timeout: 10000, interval: 200 })
    }
    // Seam: native folder dialog can't be driven by wdio — return the fixture path.
    await browser.execute((dir: string) => {
      ;(window as unknown as { __hipPickDir?: () => Promise<string> }).__hipPickDir = () => Promise.resolve(dir)
    }, FIXTURE)
  })

  it('selects a folder and renders the file tree', async () => {
    await (await browser.$('[data-testid="toggle-panel"]')).click()
    await (await browser.$('[data-testid="tab-files"]')).click()
    await (await browser.$('[data-testid="select-folder"]')).click()
    // The sidecar cold-starts (tsx compiles the TS entry on first launch), so the
    // WebSocket may still be connecting when we pick the folder. wsClient buffers
    // sends made while connecting and flushes them on open, so session:create +
    // session:setCwd + fs:ls all land once connected — we just wait generously.
    await (await entry('/README.md')).waitForExist({ timeout: 120000 })
    expect(await (await entry('/src')).isExisting()).toBe(true)
  })

  it('lazily expands a directory', async () => {
    await (await entry('/src')).click()
    await (await entry('/a.ts')).waitForExist({ timeout: 30000 })
    expect(await (await entry('/a.ts')).isExisting()).toBe(true)
  })

  it('renders a Markdown preview (rendered, not source)', async () => {
    await (await entry('/README.md')).click()
    const md = await browser.$('[data-testid="preview-markdown"]')
    await md.waitForExist({ timeout: 30000 })
    await browser.waitUntil(async () => (await md.getText()).includes('Sample Project'), {
      timeout: 10000,
      interval: 500,
      timeoutMsg: 'markdown content did not render',
    })
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
    await browser.waitUntil(async () => ((await img.getAttribute('src')) ?? '').includes('data:image/png;base64,'), {
      timeout: 10000,
      interval: 500,
      timeoutMsg: 'image did not load as a data URL',
    })
  })

  it('renders a code/text file as monospace text', async () => {
    // src/ was expanded in the earlier test, so a.ts is in the tree.
    await (await entry('/a.ts')).click()
    const txt = await browser.$('[data-testid="preview-text"]')
    await txt.waitForExist({ timeout: 30000 })
    await browser.waitUntil(async () => (await txt.getText()).includes('export const a'), {
      timeout: 10000,
      interval: 500,
      timeoutMsg: 'text content did not render',
    })
  })
})
