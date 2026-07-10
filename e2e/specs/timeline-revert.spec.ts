// Phase 3 H8: Timeline revert confirm open / cancel / confirm success (seeded; no real git).
import { expect } from 'expect-webdriverio'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  createCodeSessionForE2e,
  seedCheckpoints,
  waitForHipE2E,
} from '../helpers/e2e-hooks.js'
import { closePanelMenu, listPanelMenuTabs, selectPanelTab } from '../helpers/panel.js'
import { switchToCodeSurface } from '../helpers/surface.js'

let dir: string

async function ensureTimelineSeeded(sessionId: string): Promise<void> {
  await browser.waitUntil(
    async () => {
      await seedCheckpoints(sessionId)
      const tabs = await listPanelMenuTabs()
      await closePanelMenu()
      return tabs.includes('panel-tab-timeline')
    },
    {
      timeout: 20000,
      interval: 500,
      timeoutMsg: 'timeline tab never available after seedCheckpoints',
    },
  )
  await selectPanelTab('timeline')
  await browser.waitUntil(
    async () => {
      await seedCheckpoints(sessionId)
      return (await (await browser.$$('[data-testid="timeline-row"]')).length) >= 2
    },
    { timeout: 20000, interval: 400, timeoutMsg: 'expected seeded timeline rows' },
  )
}

describe('timeline revert confirm @panel @harness', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await waitForHipE2E()
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hip-e2e-timeline-revert-'))
    fs.writeFileSync(path.join(dir, 'hello.txt'), 'hello\n')
    await switchToCodeSurface()
  })

  after(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  })

  it('opens revert confirm, cancel dismisses, confirm auto-succeeds when seeded', async () => {
    const sessionId = await createCodeSessionForE2e(dir)
    expect(sessionId).toBeTruthy()
    await browser.waitUntil(
      async () => (await (await browser.$$('[data-testid="session-tab"]')).length) >= 1,
      { timeout: 30000, interval: 300 },
    )
    await (await browser.$('[data-testid="toggle-panel"]')).waitForExist({ timeout: 30000 })

    await ensureTimelineSeeded(sessionId)

    const revertBtns = await browser.$$('[data-testid="timeline-revert"]')
    expect(revertBtns.length).toBeGreaterThanOrEqual(1)

    // Open confirm modal
    await browser.execute((el: HTMLElement) => el.click(), revertBtns[0])
    const confirm = await browser.$('[data-testid="timeline-revert-confirm"]')
    await confirm.waitForExist({ timeout: 10000 })
    const cancel = await browser.$('[data-testid="timeline-revert-cancel"]')
    await cancel.waitForExist({ timeout: 5000 })

    // Cancel closes without completing a revert
    await browser.execute((el: HTMLElement) => el.click(), cancel)
    await browser.waitUntil(async () => !(await (await browser.$('[data-testid="timeline-revert-confirm"]')).isExisting()), {
      timeout: 10000,
      interval: 200,
      timeoutMsg: 'revert modal still open after cancel',
    })

    // Re-open and confirm — seed pin auto-succeeds via sessionService.revertCheckpoint
    const revertAgain = (await browser.$$('[data-testid="timeline-revert"]'))[0]
    await browser.execute((el: HTMLElement) => el.click(), revertAgain)
    const confirmAgain = await browser.$('[data-testid="timeline-revert-confirm"]')
    await confirmAgain.waitForExist({ timeout: 10000 })
    await browser.execute((el: HTMLElement) => el.click(), confirmAgain)

    await browser.waitUntil(async () => !(await (await browser.$('[data-testid="timeline-revert-confirm"]')).isExisting()), {
      timeout: 15000,
      interval: 200,
      timeoutMsg: 'revert modal still open after confirm (expected e2e seed auto-success)',
    })

    expect(await (await browser.$('[data-testid="timeline-view"]')).isExisting()).toBe(true)
  })
})
