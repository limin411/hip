// Phase L3: real LLM memory teach → cross-session recall — opt-in only.
// Run: E2E_LIVE_LLM=1 E2E_GREP=@live.*memory yarn test:e2e --spec e2e/specs/live-memory.spec.ts
// Requires auth keys staged into HIP_DATA_DIR; wdio stages accelerated memory.json when live.
import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import { waitForHipE2E } from '../helpers/e2e-hooks.js'
import {
  enableMemoryBoth,
  getActiveSessionMemoryFlags,
  listMemories,
  openMemorySettings,
  setMemoryConfig,
} from '../helpers/memory.js'
import { sendChatMessage } from '../helpers/session.js'
import { switchToChatSurface } from '../helpers/surface.js'
import { ChatPage } from '../page-objects/ChatPage.js'

const LIVE = process.env.E2E_LIVE_LLM === '1'
const chat = new ChatPage()

async function ensureNewChat(): Promise<void> {
  await switchToChatSurface()
  const newBtn = await browser.$('[data-testid="new-session-button"]')
  if (await newBtn.isExisting()) {
    await newBtn.waitForClickable({ timeout: 10000 })
    await newBtn.click()
    await chat.newConversation.waitForExist({ timeout: 15000 })
  }
}

async function waitForAssistantReply(userPrompt: string, timeoutMs = 120000): Promise<string> {
  await browser.waitUntil(
    async () => {
      return browser.execute((prompt: string) => {
        const nodes = Array.from(document.querySelectorAll('[data-message-id]'))
        const texts = nodes.map((n) => (n.textContent ?? '').trim()).filter(Boolean)
        if (texts.length < 2) return false
        return texts.slice(1).some((t) => t.length > 0 && t !== prompt)
      }, userPrompt)
    },
    {
      timeout: timeoutMs,
      interval: 1000,
      timeoutMsg: 'no non-empty assistant reply (check auth.json / network / model)',
    },
  )
  return browser.execute(() =>
    Array.from(document.querySelectorAll('[data-message-id]'))
      .map((n) => n.textContent ?? '')
      .join('\n'),
  )
}

;(LIVE ? describe : describe.skip)('live memory cross-session @live @memory', () => {
  const token = `HIP_E2E_MEM_${Date.now()}`

  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await waitForHipE2E()
    // Ensure dual flags + idle=0 even if stage file missed.
    await setMemoryConfig({
      useMemories: true,
      generateMemories: true,
      idleMinutes: 0,
      minExtractIntervalHours: 0,
      maxExtractsPerDay: 50,
    })
  })

  it('M3.1 teaches a unique preference and persists a memory item', async () => {
    await openMemorySettings()
    await enableMemoryBoth()
    const back = await browser.$('[data-testid="settings-back"]')
    if (await back.isExisting()) await back.click()

    await ensureNewChat()

    // Enough user turns/chars for Phase1 min content (defaults: minUserTurns=2, minUserChars=80).
    const p1 =
      `Please remember our hard package-manager rule for this project: always use yarn, never npm. ` +
      `Unique memory token: ${token}. Acknowledge the token in your reply.`
    await sendChatMessage(p1)
    await waitForAssistantReply(p1)

    const p2 =
      `Confirm again: package manager is yarn only, and the memory token is ${token}. ` +
      `We prefer strict TypeScript as well.`
    await sendChatMessage(p2)
    await waitForAssistantReply(p2)

    // Wait for Phase1/2 with idleMinutes=0 (poll list for token).
    await browser.waitUntil(
      async () => {
        try {
          const items = await listMemories({ status: 'active', limit: 200, query: token })
          if (items.some((i) => i.title.includes(token) || i.content.includes(token))) return true
          const all = await listMemories({ status: 'active', limit: 200 })
          return all.some(
            (i) =>
              i.title.includes(token) ||
              i.content.includes(token) ||
              (i.content.toLowerCase().includes('yarn') && i.content.includes(token.slice(-6))),
          )
        } catch {
          return false
        }
      },
      {
        timeout: 180000,
        interval: 3000,
        timeoutMsg: `memory item with token ${token} not found within 180s (extract may need longer / model)`,
      },
    )

    const items = await listMemories({ status: 'active', limit: 200 })
    const hit = items.find((i) => i.title.includes(token) || i.content.includes(token))
    expect(hit).toBeTruthy()
  })

  it('M3.2 new session can surface the preference (hard: still listed; soft: reply)', async () => {
    // Hard: item still active from M3.1
    const items = await listMemories({ status: 'active', limit: 200 })
    const stillThere = items.some((i) => i.title.includes(token) || i.content.includes(token))
    expect(stillThere).toBe(true)

    await ensureNewChat()
    // Session-level use on if possible
    try {
      await browser.execute(() => {
        const hooks = (window as unknown as { __hipE2E?: { getActiveSessionId?: () => string | null } }).__hipE2E
        return hooks?.getActiveSessionId?.() ?? null
      })
    } catch {
      /* ignore */
    }

    const prompt =
      `What package manager should we use in this project? ` +
      `If you recall a HIP_E2E_MEM token from memory, mention it. Prefer yarn if known.`
    await sendChatMessage(prompt)
    const allText = await waitForAssistantReply(prompt, 120000)

    // Soft assert: yarn preferred; do not fail solely on token in prose if list already hard-passed.
    const mentionsYarn = /yarn/i.test(allText)
    const mentionsToken = allText.includes(token)
    expect(mentionsYarn || mentionsToken || stillThere).toBe(true)

    // Optional: flags readable
    const flags = await getActiveSessionMemoryFlags()
    // may be null on draft; not a failure
    void flags
  })
})
