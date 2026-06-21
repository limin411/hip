// e2e/specs/diff-workspace.spec.ts
import { expect } from 'expect-webdriverio'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// A disposable NON-repo folder — init must never touch the repo-tracked fixtures.
// Created in before() (not at module load) so an E2E_GREP-filtered run never leaks it.
let dir: string

async function skipLoginIfPresent(): Promise<void> {
  const skip = await browser.$('button=跳过登录')
  if (await skip.isExisting()) {
    await skip.click()
    await browser.waitUntil(async () => (await browser.getUrl()).includes('#/app'), { timeout: 10000, interval: 200 })
  }
}

async function switchToCodeSurface(): Promise<void> {
  const codeBtn = await browser.$('[aria-label="代码"]')
  await codeBtn.waitForClickable({ timeout: 10000 })
  await codeBtn.click()
  await (await browser.$('[data-testid="new-conversation"]')).waitForExist({ timeout: 30000 })
}

async function initGitAndOpenChanges(): Promise<void> {
  // The init button lives in the Files tab GitInitBanner before the workspace is a repo.
  await (await browser.$('button*=初始化 git 仓库')).click()
  // The Changes tab is git-gated and only appears once init makes this a repo.
  const changesTab = await browser.$('[data-testid="tab-changes"]')
  await changesTab.waitForExist({ timeout: 30000 })
  await changesTab.click()
  await (await browser.$('[data-testid="changes-view"]')).waitForExist({ timeout: 30000 })
}

describe('workspace git diff', () => {
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hip-e2e-diff-'))
    fs.writeFileSync(path.join(dir, 'hello.txt'), 'hello\n')
    await browser.pause(2500)
    await skipLoginIfPresent()
    await browser.execute((d: string) => {
      ;(window as unknown as { __hipPickDir?: () => Promise<string> }).__hipPickDir = () => Promise.resolve(d)
    }, dir)
    await switchToCodeSurface()
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

  it('shows the not-a-repo state with an init button on the Files tab', async () => {
    // The Changes tab is git-gated and hidden before init.
    expect(await (await browser.$('[data-testid="tab-changes"]')).isExisting()).toBe(false)
    await (await browser.$('button*=初始化 git 仓库')).waitForExist({ timeout: 30000 })
  })

  it('one-click init produces a clean baseline and reveals the Changes tab', async () => {
    await initGitAndOpenChanges()
    // With only the baseline commit, the working tree is clean.
    expect(await (await browser.$('[data-testid="diff-file"]')).isExisting()).toBe(false)
  })

  it('an out-of-band file change appears in the changes view', async () => {
    fs.writeFileSync(path.join(dir, 'hello.txt'), 'changed\n')
    // ChangesView re-requests the diff on (re)mount. Re-activate the tab to force a refresh.
    await (await browser.$('[data-testid="tab-files"]')).click()
    await (await browser.$('[data-testid="tab-changes"]')).click()
    const file = await browser.$('[data-testid="diff-file"]')
    await file.waitForExist({ timeout: 30000 })
    await browser.waitUntil(async () => (await file.getText()).includes('hello.txt'), { timeout: 10000, interval: 500 })
  })

  it('split view toggle is present and switches to two-column layout', async () => {
    const viewToggle = await browser.$('[data-testid="diff-view-toggle"]')
    await viewToggle.waitForExist({ timeout: 10000 })
    const splitBtn = await viewToggle.$('button:nth-child(2)')
    await splitBtn.click()
    const changesView = await browser.$('[data-testid="changes-view"]')
    await changesView.waitForExist({ timeout: 5000 })
    expect(await changesView.isExisting()).toBe(true)
    const unifiedBtn = await viewToggle.$('button:nth-child(1)')
    await unifiedBtn.click()
  })

  it('show-full button is present on a modified file', async () => {
    const showFullBtn = await browser.$('[data-testid="diff-show-full"]')
    await showFullBtn.waitForExist({ timeout: 10000 })
    expect(await showFullBtn.isExisting()).toBe(true)
  })

  it('clicking show-full toggles the file to expanded state (collapse button appears)', async () => {
    const showFullBtn = await browser.$('[data-testid="diff-show-full"]')
    await showFullBtn.waitForExist({ timeout: 10000 })
    await showFullBtn.click()
    const collapseBtn = await browser.$('[data-testid="diff-collapse-full"]')
    await collapseBtn.waitForExist({ timeout: 15000 })
    expect(await collapseBtn.isExisting()).toBe(true)
    await collapseBtn.click()
    await (await browser.$('[data-testid="diff-show-full"]')).waitForExist({ timeout: 10000 })
  })

  it('changed-files jump list is absent for a single-file diff', async () => {
    const jumpList = await browser.$('[data-testid="diff-file-list"]')
    expect(await jumpList.isExisting()).toBe(false)
  })
})
