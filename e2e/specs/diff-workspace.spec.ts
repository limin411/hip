// e2e/specs/diff-workspace.spec.ts
import { expect } from 'expect-webdriverio'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// A disposable NON-repo folder — init must never touch the repo-tracked fixtures.
// Created in before() (not at module load) so an E2E_GREP-filtered run never leaks it.
let dir: string

describe('workspace git diff', () => {
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hip-e2e-diff-'))
    fs.writeFileSync(path.join(dir, 'hello.txt'), 'hello\n')
    await browser.pause(2500)
    const skip = await browser.$('button=跳过登录')
    if (await skip.isExisting()) {
      await browser.execute((el: HTMLElement) => el.click(), (await skip) as unknown as HTMLElement)
      await browser.waitUntil(async () => (await browser.getUrl()).includes('#/app'), { timeout: 10000, interval: 200 })
    }
    await browser.execute((d: string) => {
      ;(window as unknown as { __hipPickDir?: () => Promise<string> }).__hipPickDir = () => Promise.resolve(d)
    }, dir)
  })

  after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }) })

  it('commits a session bound to the temp folder', async () => {
    await (await browser.$('[data-testid="new-conversation"]')).waitForExist({ timeout: 120000 })
    await (await browser.$('[data-testid="pick-folder"]')).click()
    await (await browser.$(`[data-testid="tree-entry"][data-path$="/hello.txt"]`)).waitForExist({ timeout: 60000 })
    const ta = await browser.$('[data-testid="new-conversation"] textarea')
    await ta.click()
    await browser.keys('diff e2e')
    const send = await browser.$('[data-testid="new-conversation"] [data-testid="composer-send"]')
    await send.waitForEnabled({ timeout: 10000 })
    await send.click()
    await (await browser.$('[data-testid="new-conversation"]')).waitForExist({ reverse: true, timeout: 30000 })
  })

  it('shows the not-a-repo state with an init button on the Diff tab', async () => {
    await (await browser.$('[data-testid="tab-diff"]')).click()
    await (await browser.$('[data-testid="diff-init"]')).waitForExist({ timeout: 30000 })
  })

  it('one-click init produces a clean baseline', async () => {
    await (await browser.$('[data-testid="diff-init"]')).click()
    await (await browser.$('[data-testid="diff-clean"]')).waitForExist({ timeout: 30000 })
  })

  it('an out-of-band file change appears after manual refresh', async () => {
    fs.writeFileSync(path.join(dir, 'hello.txt'), 'changed\n')
    await (await browser.$('[data-testid="diff-refresh"]')).click()
    const file = await browser.$('[data-testid="diff-file"]')
    await file.waitForExist({ timeout: 30000 })
    await browser.waitUntil(async () => (await file.getText()).includes('hello.txt'), { timeout: 10000, interval: 500 })
  })
})
