// e2e/specs/harness-copy-debug.spec.ts
// Phase 1 H4: copy-debug visible on error; redacted bundle via __hipE2E.
import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  createChatSessionForE2e,
  getSessionDebugBundleJson,
  simulateSessionError,
  waitForHipE2E,
} from '../helpers/e2e-hooks.js'
import { switchToChatSurface } from '../helpers/surface.js'
import { ChatPage } from '../page-objects/ChatPage.js'

const chat = new ChatPage()

describe('harness copy debug @harness @smoke', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await waitForHipE2E()
    await switchToChatSurface()
  })

  it('shows copy-debug on error and returns a redacted bundle', async () => {
    const sessionId = await createChatSessionForE2e()
    expect(sessionId).toBeTruthy()

    await simulateSessionError(sessionId, 'AGENT_ERROR', 'e2e simulated error')

    const err = await chat.chatError
    await err.waitForExist({ timeout: 15000 })
    expect(await err.isExisting()).toBe(true)

    const copyBtn = await browser.$('[data-testid="chat-copy-debug"]')
    await copyBtn.waitForExist({ timeout: 10000 })
    await browser.execute((el: HTMLElement) => el.click(), copyBtn)

    const json = await getSessionDebugBundleJson()
    expect(json).toBeTruthy()
    const parsed = JSON.parse(json!) as {
      version: number
      session: { id: string; config: Record<string, unknown> }
      recentErrors?: Array<{ code?: string }>
    }
    expect(parsed.version).toBe(1)
    expect(parsed.session.id).toBe(sessionId)
    expect(parsed.recentErrors?.some((e) => e.code === 'AGENT_ERROR')).toBe(true)
    // Redaction: no obvious secret keys as plaintext values.
    const raw = json!
    expect(raw).not.toMatch(/sk-[a-zA-Z0-9]{8,}/)
    expect(JSON.stringify(parsed.session.config)).not.toContain('apiKey')
  })
})
