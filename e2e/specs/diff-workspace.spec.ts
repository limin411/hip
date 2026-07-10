// e2e/specs/diff-workspace.spec.ts
import { expect } from 'expect-webdriverio'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  commitCodeSessionWithDir,
  diffFileTexts,
  initGitAndOpenChanges,
  reopenChangesTab,
} from '../helpers/git-workspace.js'
import { switchToCodeSurface } from '../helpers/surface.js'
import { CodePage } from '../page-objects/CodePage.js'

// A disposable NON-repo folder — init must never touch the repo-tracked fixtures.
// Created in before() (not at module load) so an E2E_GREP-filtered run never leaks it.
let dir: string
const codePage = new CodePage()

describe('workspace git diff @core', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hip-e2e-diff-'))
    fs.writeFileSync(path.join(dir, 'hello.txt'), 'hello\n')
    await switchToCodeSurface()
  })

  after(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  })

  it('commits a session bound to the temp folder', async () => {
    await commitCodeSessionWithDir(dir, 'diff e2e', '/hello.txt')
  })

  it('shows the not-a-repo state with an init button on the Files tab', async () => {
    // The Changes tab is git-gated and hidden before init.
    expect(await (await browser.$('[data-testid="tab-changes"]')).isExisting()).toBe(false)
    await (await codePage.gitInitButton).waitForExist({ timeout: 30000 })
  })

  it('one-click init produces a clean baseline and reveals the Changes tab', async () => {
    await initGitAndOpenChanges()
    // With only the baseline commit, the working tree is clean.
    expect(await (await browser.$('[data-testid="diff-file"]')).isExisting()).toBe(false)
  })

  it('shows the baseline commit in the commit log', async () => {
    // Changes tab is already open from the previous test.
    const row = await browser.$('[data-testid="commit-row"]')
    await row.waitForExist({ timeout: 30000 })
    expect(await row.getText()).toContain('hip baseline')
  })

  it('an out-of-band file change appears in the changes view', async () => {
    // The sidecar has no live fs watcher, so re-activate the Changes tab to
    // trigger a fresh diff pull after the external edit.
    fs.writeFileSync(path.join(dir, 'hello.txt'), 'changed\n')
    await reopenChangesTab()

    const file = await browser.$('[data-testid="diff-file"]')
    await file.waitForExist({ timeout: 30000 })
    await browser.waitUntil(async () => (await file.getText()).includes('hello.txt'), {
      timeout: 10000,
      interval: 500,
    })
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

  // C7: multi-file jump list
  it('shows jump list when two files are changed', async () => {
    fs.writeFileSync(path.join(dir, 'second.txt'), 'second file\n')
    await reopenChangesTab()

    await browser.waitUntil(
      async () => {
        const joined = await diffFileTexts()
        return joined.includes('hello.txt') && joined.includes('second.txt')
      },
      { timeout: 30000, interval: 500, timeoutMsg: 'expected two diff files' },
    )

    const jumpList = await browser.$('[data-testid="diff-file-list"]')
    await jumpList.waitForExist({ timeout: 15000 })
    const jumps = await browser.$$('[data-testid="diff-file-jump"]')
    expect(jumps.length).toBeGreaterThanOrEqual(2)
  })
})
