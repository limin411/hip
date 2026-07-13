// Multi-track A/B: agent:interrupt HITL banner + resume clears interrupt (no paid LLM).
import { expect } from 'expect-webdriverio'
import { leaveSpecialViewsIfOpen, waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  createChatSessionForE2e,
  getPendingInterrupt,
  seedAgentInterrupt,
  waitForHipE2E,
} from '../helpers/e2e-hooks.js'
import { switchToChatSurface } from '../helpers/surface.js'
import { ChatPage } from '../page-objects/ChatPage.js'

const chat = new ChatPage()

describe('harness agent interrupt @harness @core', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await leaveSpecialViewsIfOpen()
    await waitForHipE2E()
    try {
      await switchToChatSurface()
    } catch {
      // Shared app may already be on chat.
    }
  })

  it('shows interrupt banner and clears it after resume reply', async () => {
    const sessionId = await createChatSessionForE2e()
    expect(sessionId).toBeTruthy()

    const { question } = await seedAgentInterrupt(sessionId, 'How should I proceed with the e2e task?')
    expect(question).toContain('e2e task')

    const banner = await chat.chatInterrupt
    await banner.waitForExist({ timeout: 15000 })
    expect(await banner.getText()).toContain('How should I proceed with the e2e task?')

    await browser.waitUntil(
      async () => {
        const pending = await getPendingInterrupt(sessionId)
        return pending?.question.includes('e2e task') ?? false
      },
      { timeout: 10000, interval: 200, timeoutMsg: 'getPendingInterrupt not set' },
    )

    // Resume path: composer send → message:resume (sessionService routes when interrupt pending).
    const ta = await chat.activeTextarea
    await ta.waitForExist({ timeout: 10000 })
    await ta.click()
    await ta.setValue('Continue with option A for e2e')
    const send = await browser.$('[data-testid="composer-send"]')
    await send.waitForExist({ timeout: 5000 })
    await browser.execute((el: HTMLElement) => el.click(), send)

    await browser.waitUntil(
      async () => !(await (await chat.chatInterrupt).isExisting()),
      {
        timeout: 15000,
        interval: 300,
        timeoutMsg: 'chat-interrupt still visible after resume',
      },
    )
    await browser.waitUntil(
      async () => (await getPendingInterrupt(sessionId)) === null,
      {
        timeout: 10000,
        interval: 200,
        timeoutMsg: 'pending interrupt not cleared after resume',
      },
    )
  })
})
