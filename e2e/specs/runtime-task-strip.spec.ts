// Runtime task strip above the composer (replaces the old right-panel Agents/Runtime tab).
// Seeded via __hipE2E.seedRuntimeTask — no paid LLM.
import { expect } from 'expect-webdriverio'
import * as path from 'node:path'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  createCodeSessionForE2e,
  seedRuntimeTask,
  waitForHipE2E,
} from '../helpers/e2e-hooks.js'
import { switchToCodeSurface } from '../helpers/surface.js'

const FIXTURE = path.resolve('e2e/fixtures/sample-project')

describe('runtime task strip @harness @core', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await waitForHipE2E()
    await switchToCodeSurface()
  })

  it('shows a seeded running task above the composer with kind label and stop button', async () => {
    const sessionId = await createCodeSessionForE2e(FIXTURE)
    expect(sessionId).toBeTruthy()

    await browser.waitUntil(
      async () => (await (await browser.$$('[data-session-tab="true"]')).length) >= 1,
      { timeout: 30000, interval: 300 },
    )

    // No tasks yet — strip must not exist.
    const before = await browser.$('[data-testid="runtime-task-strip"]')
    expect(await before.isExisting()).toBe(false)

    const { taskId } = await seedRuntimeTask(sessionId, {
      kind: 'shell',
      description: 'e2e runtime shell job',
    })
    expect(taskId).toMatch(/^e2e-rt-/)

    const strip = await browser.$('[data-testid="runtime-task-strip"]')
    await strip.waitForExist({ timeout: 15000 })
    expect(await strip.isExisting()).toBe(true)

    const row = await strip.$('[data-testid="runtime-task-row"]')
    await row.waitForExist({ timeout: 5000 })
    expect(await row.getText()).toContain('e2e runtime shell job')
    expect(await row.getText()).toContain('shell')
    expect(await row.$('button').isExisting()).toBe(true)

    // Stop button present for the running task.
    const stop = await row.$('button')
    expect(await stop.isExisting()).toBe(true)
  })

  it('hides the strip once the seeded task completes', async () => {
    const sessionId = await createCodeSessionForE2e(FIXTURE)
    expect(sessionId).toBeTruthy()

    await browser.waitUntil(
      async () => (await (await browser.$$('[data-session-tab="true"]')).length) >= 1,
      { timeout: 30000, interval: 300 },
    )

    await seedRuntimeTask(sessionId, { kind: 'agent', status: 'running' })
    const strip = await browser.$('[data-testid="runtime-task-strip"]')
    await strip.waitForExist({ timeout: 15000 })

    // Overwrite with a completed task — the snapshot replaces the list and the
    // strip filters to running/scheduled only, so it must disappear.
    const { taskId } = await seedRuntimeTask(sessionId, {
      kind: 'monitor',
      status: 'completed',
    })
    expect(taskId).toMatch(/^e2e-rt-/)

    await browser.waitUntil(
      async () => !(await (await browser.$('[data-testid="runtime-task-strip"]')).isExisting()),
      { timeout: 15000, interval: 300 },
    )
  })
})
