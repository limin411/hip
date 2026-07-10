// Phase 2 H3: write → Changes then cancel still keeps diff paths.
import { expect } from 'expect-webdriverio'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  createCodeSessionForE2e,
  simulateAgentWriteFinished,
  simulateTurnCancelled,
  simulateTurnRunning,
  waitForHipE2E,
} from '../helpers/e2e-hooks.js'
import { diffFileTexts, initGitAndOpenChanges } from '../helpers/git-workspace.js'
import { selectPanelTab } from '../helpers/panel.js'
import { switchToCodeSurface } from '../helpers/surface.js'
import { CodePage } from '../page-objects/CodePage.js'

let dir: string
const codePage = new CodePage()

describe('harness cancel keeps Changes @harness @core', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await waitForHipE2E()
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hip-e2e-cancel-diff-'))
    fs.writeFileSync(path.join(dir, 'hello.txt'), 'hello\n')
    await switchToCodeSurface()
  })

  after(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  })

  it('keeps diff paths after cancel following a simulated write', async () => {
    const sessionId = await createCodeSessionForE2e(dir)
    expect(sessionId).toBeTruthy()

    await browser.waitUntil(
      async () => (await (await browser.$$('[data-testid="session-tab"]')).length) >= 1,
      { timeout: 30000, interval: 300 },
    )
    await (await browser.$('[data-testid="toggle-panel"]')).waitForExist({ timeout: 30000 })
    await selectPanelTab('files')
    await (await codePage.gitInitButton).waitForExist({ timeout: 60000 })
    await initGitAndOpenChanges()

    fs.writeFileSync(path.join(dir, 'hello.txt'), 'agent-changed\n')
    fs.writeFileSync(path.join(dir, 'after-cancel.txt'), 'still here\n')
    await simulateAgentWriteFinished(sessionId)

    const file = await browser.$('[data-testid="diff-file"]')
    await file.waitForExist({ timeout: 30000 })
    await browser.waitUntil(
      async () => {
        const joined = await diffFileTexts()
        return joined.includes('hello.txt') || joined.includes('after-cancel.txt')
      },
      { timeout: 30000, interval: 500 },
    )

    await simulateTurnRunning(sessionId)
    await simulateTurnCancelled(sessionId)

    // Stay on Changes — paths must still be listed.
    await (await browser.$('[data-testid="changes-view"]')).waitForExist({ timeout: 10000 })
    await browser.waitUntil(
      async () => {
        const joined = await diffFileTexts()
        return joined.includes('hello.txt') || joined.includes('after-cancel.txt')
      },
      { timeout: 15000, interval: 500, timeoutMsg: 'diff paths disappeared after cancel' },
    )
    expect(await diffFileTexts()).toMatch(/hello\.txt|after-cancel\.txt/)
  })
})
