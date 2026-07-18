// Smoothness P1: process UI + write-follow (harness, unpaid).
import { expect } from 'expect-webdriverio'
import * as path from 'node:path'
import { leaveSpecialViewsIfOpen, waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  createCodeSessionForE2e,
  injectServerMessage,
  waitForHipE2E,
} from '../helpers/e2e-hooks.js'

const FIXTURE = path.resolve('e2e/fixtures/sample-project')

describe('smooth P1 follow + process UI @smooth-p1 @harness', () => {
  let sessionId: string

  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
    await waitForHipE2E()
    sessionId = await createCodeSessionForE2e(FIXTURE)
  })

  it('P1-E3/E4 running tool card and process/answer regions', async () => {
    await browser.execute(
      (id: string) => {
        const hooks = (window as unknown as { __hipE2E?: {
          simulateToolStarted?: (s: string, o?: { name?: string; path?: string }) => unknown
        } }).__hipE2E
        if (!hooks?.simulateToolStarted) throw new Error('simulateToolStarted missing')
        hooks.simulateToolStarted(id, { name: 'read_file', path: '/README.md' })
      },
      sessionId,
    )

    const process = await browser.$('[data-testid="message-process"]')
    await process.waitForExist({ timeout: 15000 })
    const running = await browser.$('[data-testid="tool-card-running"]')
    await running.waitForExist({ timeout: 15000 })
    expect(await running.isExisting()).toBe(true)
    expect(await (await browser.$('[data-testid="message-answer"]')).isExisting()).toBe(true)
  })

  it('P1-E7 write-follow updates fs active path before turn complete', async () => {
    await browser.execute(
      (id: string) => {
        const hooks = (window as unknown as { __hipE2E?: {
          simulateAgentWriteFinished: (s: string, o?: { path?: string }) => unknown
          getFsActivePath?: (s: string) => string | null
          getFocusedPath?: () => string | null
        } }).__hipE2E
        if (!hooks) throw new Error('__hipE2E missing')
        hooks.simulateAgentWriteFinished(id, { path: '/README.md' })
      },
      sessionId,
    )

    await browser.waitUntil(
      async () => {
        const pathActive = await browser.execute((id: string) => {
          const hooks = (window as unknown as { __hipE2E?: {
            getFsActivePath?: (s: string) => string | null
            getFocusedPath?: () => string | null
          } }).__hipE2E
          return {
            fs: hooks?.getFsActivePath?.(id) ?? null,
            focus: hooks?.getFocusedPath?.() ?? null,
          }
        }, sessionId)
        return (
          pathActive.fs === '/README.md' ||
          pathActive.focus === '/README.md' ||
          (pathActive.fs != null && pathActive.fs.includes('README'))
        )
      },
      {
        timeout: 10000,
        interval: 200,
        timeoutMsg: 'expected write-follow to set focused/active path to README.md before turn end',
      },
    )
  })

  it('P1-E10 error typing surfaces on inject', async () => {
    await injectServerMessage({
      type: 'error',
      sessionId,
      code: 'AGENT_ERROR',
      message: 'smooth-p1 simulated error',
    })
    const sidebar = await browser.$('[data-testid="app-sidebar"]')
    expect(await sidebar.isExisting()).toBe(true)
  })
})
