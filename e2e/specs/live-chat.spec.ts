// Phase 3 L1: real LLM chat happy path — opt-in only (never part of gate).
// Run: E2E_LIVE_LLM=1 yarn test:e2e:live
// Requires auth keys staged into HIP_DATA_DIR (wdio copies ~/.hip/config/auth.json when present).
import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { sendChatMessage } from '../helpers/session.js'
import { switchToChatSurface } from '../helpers/surface.js'
import { ChatPage } from '../page-objects/ChatPage.js'

const LIVE = process.env.E2E_LIVE_LLM === '1'
const chat = new ChatPage()

;(LIVE ? describe : describe.skip)('live chat happy path @live', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await switchToChatSurface()
  })

  it('sends a short prompt and receives a non-empty assistant reply', async () => {
    // Fresh draft so we do not append to a prior session mid-suite.
    const newBtn = await browser.$('[data-testid="new-session-button"]')
    if (await newBtn.isExisting()) {
      await newBtn.waitForClickable({ timeout: 10000 })
      await newBtn.click()
      await chat.newConversation.waitForExist({ timeout: 15000 })
    }

    const prompt = 'Reply with exactly: pong'
    await sendChatMessage(prompt)

    const userBubble = await browser.$(`//*[@data-message-id][contains(., "${prompt}")]`)
    await userBubble.waitForExist({ timeout: 30000 })

    // Wait for an assistant bubble (not the user message) with non-empty body.
    await browser.waitUntil(
      async () => {
        return browser.execute((userPrompt: string) => {
          const nodes = Array.from(document.querySelectorAll('[data-message-id]'))
          const texts = nodes.map((n) => (n.textContent ?? '').trim()).filter(Boolean)
          if (texts.length < 2) return false
          if (texts.some((t) => /pong/i.test(t) && t !== userPrompt)) return true
          // Any later bubble that is not only the user prompt.
          return texts.slice(1).some((t) => t.length > 0 && t !== userPrompt)
        }, prompt)
      },
      {
        timeout: 120000,
        interval: 1000,
        timeoutMsg: 'no non-empty assistant reply within 120s (check auth.json / network / model)',
      },
    )

    const allText = (
      await browser.execute(() =>
        Array.from(document.querySelectorAll('[data-message-id]'))
          .map((n) => n.textContent ?? '')
          .join('\n'),
      )
    ).trim()
    expect(allText.length).toBeGreaterThan(prompt.length)
  })
})
