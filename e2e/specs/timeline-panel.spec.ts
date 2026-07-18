// Phase 2 P4: Timeline rows after seedCheckpoints (no real git commits required).
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

describe('timeline panel @panel @harness', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await waitForHipE2E()
    // Disposable non-repo folder so real sidecar checkpoint:list cannot overwrite seeds
    // with a parent-repo empty list (sample-project lives inside the hip checkout).
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hip-e2e-timeline-'))
    fs.writeFileSync(path.join(dir, 'hello.txt'), 'hello\n')
    await switchToCodeSurface()
  })

  after(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  })

  it('lists seeded checkpoints in timeline view', async () => {
    const sessionId = await createCodeSessionForE2e(dir)
    expect(sessionId).toBeTruthy()
    await browser.waitUntil(
      async () => (await (await browser.$$('[data-session-tab="true"]')).length) >= 1,
      { timeout: 30000, interval: 300 },
    )
    await (await browser.$('[data-testid="toggle-panel"]')).waitForExist({ timeout: 30000 })

    // Seed until git-gated tabs appear (React re-render + store patch).
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
        timeoutMsg: 'timeline tab never became available after seedCheckpoints',
      },
    )

    await selectPanelTab('timeline')

    // Keep re-seeding until rows render (sidecar may still emit empty list:result).
    await browser.waitUntil(
      async () => {
        await seedCheckpoints(sessionId)
        const rows = await browser.$$('[data-testid="timeline-row"]')
        return (await rows.length) >= 2
      },
      { timeout: 20000, interval: 400, timeoutMsg: 'expected seeded timeline rows' },
    )

    const timeline = await browser.$('[data-testid="timeline-view"]')
    await timeline.waitForExist({ timeout: 5000 })
    expect((await browser.$$('[data-testid="timeline-row"]')).length).toBeGreaterThanOrEqual(2)
  })
})

