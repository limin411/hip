// e2e/specs/write-to-changes.spec.ts
// Polish P2: agent write semantics → Changes list without tab flip.
// Does not call a paid LLM; writes on disk then injects tool:finished via __hipE2E.
import { expect } from 'expect-webdriverio'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { leaveSpecialViewsIfOpen, waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  createCodeSessionForE2e,
  getActiveSessionId,
  simulateAgentWriteFinished,
  waitForHipE2E,
} from '../helpers/e2e-hooks.js'
import { diffFileTexts, initGitAndOpenChanges, reopenChangesTab } from '../helpers/git-workspace.js'
import { selectPanelTab } from '../helpers/panel.js'
import { CodePage } from '../page-objects/CodePage.js'

let dir: string
const codePage = new CodePage()

describe('write tool → Changes auto-refresh @core @harness', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
    await waitForHipE2E()
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hip-e2e-write-changes-'))
    fs.writeFileSync(path.join(dir, 'hello.txt'), 'hello\n')
  })

  after(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  })

  it('creates a code session bound to the temp folder (no LLM)', async () => {
    const sessionId = await createCodeSessionForE2e(dir)
    expect(sessionId).toBeTruthy()
    await browser.waitUntil(
      async () =>
        (await (await browser.$(`[data-testid="sidebar-session-${sessionId}"]`)).isExisting()) ||
        (await (await browser.$$('[data-session-tab="true"]')).length) >= 1,
      { timeout: 30000, interval: 300, timeoutMsg: `session row for ${sessionId} not visible` },
    )
    await (await browser.$('[data-testid="toggle-panel"]')).waitForExist({ timeout: 30000 })
    await selectPanelTab('files')
    await (await codePage.gitInitButton).waitForExist({ timeout: 60000 })
  })

  it('init git and open Changes (clean tree)', async () => {
    await initGitAndOpenChanges()
    // Baseline only — no uncommitted files.
    expect(await (await browser.$('[data-testid="diff-file"]')).isExisting()).toBe(false)
  })

  it('write on disk + simulateAgentWriteFinished shows path without leaving Changes', async () => {
    // Stay on Changes tab — do not switch to Files and back.
    await (await browser.$('[data-testid="changes-view"]')).waitForExist({ timeout: 10000 })

    const sessionId = await getActiveSessionId()
    expect(sessionId).toBeTruthy()

    fs.writeFileSync(path.join(dir, 'hello.txt'), 'changed-by-agent\n')
    fs.writeFileSync(path.join(dir, 'agent-wrote.txt'), 'from e2e write tool path\n')

    await simulateAgentWriteFinished(sessionId!)
    // Force Changes refresh (debounce + in-flight dedupe can swallow a single request).
    await reopenChangesTab()

    // Debounce is 300ms; allow sidecar git diff round-trip.
    const file = await browser.$('[data-testid="diff-file"]')
    await file.waitForExist({ timeout: 30000 })
    await browser.waitUntil(
      async () => {
        const joined = await diffFileTexts()
        return joined.includes('hello.txt') || joined.includes('agent-wrote.txt')
      },
      { timeout: 30000, interval: 500, timeoutMsg: 'Changes did not list write path after tool:finished refresh' },
    )
  })
})
