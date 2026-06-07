import { expect } from 'expect-webdriverio'
import * as path from 'node:path'

const FIXTURE = path.resolve('e2e/fixtures/sample-project')

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
    const readme = await browser.$('[data-testid="tree-entry"][data-path$="README.md"]')
    await readme.waitForExist({ timeout: 8000 })
    expect(await (await browser.$('[data-testid="tree-entry"][data-path$="src"]')).isExisting()).toBe(true)
  })

  it('lazily expands a directory', async () => {
    await (await browser.$('[data-testid="tree-entry"][data-path$="src"]')).click()
    const child = await browser.$('[data-testid="tree-entry"][data-path$="a.ts"]')
    await child.waitForExist({ timeout: 6000 })
    expect(await child.isExisting()).toBe(true)
  })

  it('renders a Markdown preview (rendered, not source)', async () => {
    await (await browser.$('[data-testid="tree-entry"][data-path$="README.md"]')).click()
    const md = await browser.$('[data-testid="preview-markdown"]')
    await md.waitForExist({ timeout: 6000 })
    expect(await md.getText()).toContain('Sample Project')
  })

  it('renders HTML in a sandboxed iframe', async () => {
    await (await browser.$('[data-testid="tree-entry"][data-path$="index.html"]')).click()
    const frame = await browser.$('[data-testid="preview-html"]')
    await frame.waitForExist({ timeout: 6000 })
    expect(await frame.getAttribute('sandbox')).toBe('')
  })

  it('renders an image as a data URL', async () => {
    await (await browser.$('[data-testid="tree-entry"][data-path$="logo.png"]')).click()
    const img = await browser.$('[data-testid="preview-image"] img')
    await img.waitForExist({ timeout: 6000 })
    expect(await img.getAttribute('src')).toContain('data:image/png;base64,')
  })

  it('renders a code/text file as monospace text', async () => {
    // src/ was expanded in the earlier test, so a.ts is in the tree.
    await (await browser.$('[data-testid="tree-entry"][data-path$="a.ts"]')).click()
    const txt = await browser.$('[data-testid="preview-text"]')
    await txt.waitForExist({ timeout: 6000 })
    expect(await txt.getText()).toContain('export const a')
  })
})
