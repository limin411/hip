// P2: deprecated session:orchMode message must not break the session (no paid LLM).
import { expect } from 'expect-webdriverio'
import { leaveSpecialViewsIfOpen, waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  createChatSessionForE2e,
  injectServerMessage,
  seedAgentInterrupt,
  waitForHipE2E,
} from '../helpers/e2e-hooks.js'
import { switchToChatSurface } from '../helpers/surface.js'
import { ChatPage } from '../page-objects/ChatPage.js'

const chat = new ChatPage()

describe('harness orchMode compat @harness', () => {
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

  it('accepts session:orchMode inject and session remains usable', async () => {
    const sessionId = await createChatSessionForE2e()
    expect(sessionId).toBeTruthy()

    await injectServerMessage({
      type: 'session:orchMode',
      sessionId,
      orchMode: 'single',
    })

    // Session still projects interrupt after orchMode (not wedged).
    const { question } = await seedAgentInterrupt(sessionId, 'orchMode compat e2e?')
    const banner = await chat.chatInterrupt
    await banner.waitForExist({ timeout: 15000 })
    expect(await banner.getText()).toContain(question)

    // No crash: composer still present.
    await (await chat.activeTextarea).waitForExist({ timeout: 10000 })
  })
})
