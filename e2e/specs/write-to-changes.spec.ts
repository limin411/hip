// e2e/specs/write-to-changes.spec.ts
// Polish P2: agent write semantics → Changes list without tab flip.
// Does not call a paid LLM; writes on disk then injects tool:finished via __hipE2E.
import { expect } from 'expect-webdriverio'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { getActiveSessionId, simulateAgentWriteFinished, waitForHipE2E } from '../helpers/e2e-hooks.js'
import { switchToCodeSurface } from '../helpers/surface.js'
import { CodePage } from '../page-objects/CodePage.js'

let dir: string
const codePage = new CodePage()

async function initGitAndOpenChanges(): Promise<void> {
  const init = await codePage.gitInitButton
  await init.waitForExist({ timeout: 30000 })
  await init.click()
  const changesTab = await browser.$('[data-testid="tab-changes"]')
  await changesTab.waitForExist({ timeout: 30000 })
  await changesTab.click()
  await (await browser.$('[data-testid="changes-view"]')).waitForExist({ timeout: 30000 })
}

describe('write tool → Changes auto-refresh', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await waitForHipE2E()
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hip-e2e-write-changes-'))
    fs.writeFileSync(path.join(dir, 'hello.txt'), 'hello\n')
    await switchToCodeSurface()
  })

  after(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  })

  it('commits a session bound to the temp folder', async () => {
    await codePage.newConversation.waitForExist({ timeout: 120000 })
    await codePage.pickDirectory(dir)
    await (await codePage.entry('/hello.txt')).waitForExist({ timeout: 60000 })
    const ta = await browser.$('[data-testid="new-conversation"] textarea')
    await ta.click()
    await browser.keys('write-to-changes e2e')
    const send = await browser.$('[data-testid="new-conversation"] [data-testid="composer-send"]')
    await send.waitForEnabled({ timeout: 10000 })
    await send.click()
    await codePage.newConversation.waitForExist({ reverse: true, timeout: 30000 })
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

    // Debounce is 300ms; allow sidecar git diff round-trip.
    const file = await browser.$('[data-testid="diff-file"]')
    await file.waitForExist({ timeout: 30000 })
    await browser.waitUntil(
      async () => {
        const rows = await browser.$$('[data-testid="diff-file"]')
        const texts = await Promise.all(rows.map((r) => r.getText()))
        const joined = texts.join('\n')
        return joined.includes('hello.txt') || joined.includes('agent-wrote.txt')
      },
      { timeout: 30000, interval: 500, timeoutMsg: 'Changes did not list write path after tool:finished refresh' },
    )
  })
})
