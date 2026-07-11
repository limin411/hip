// Memory slash commands (unpaid).
import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'
import {
  createChatSessionForE2e,
  waitForHipE2E,
} from '../helpers/e2e-hooks.js'
import { getActiveSessionMemoryFlags } from '../helpers/memory.js'
import { switchToChatSurface } from '../helpers/surface.js'
import { ChatPage } from '../page-objects/ChatPage.js'

const chat = new ChatPage()

async function typeInComposer(text: string): Promise<void> {
  const ta = await chat.activeTextarea
  await ta.waitForExist({ timeout: 10000 })
  await ta.click()
  await ta.clearValue()
  await browser.keys(text)
}

async function runSlash(cmd: string): Promise<void> {
  await typeInComposer(`/${cmd}`)
  await browser.pause(400)
  const item = await chat.slashCmd(cmd)
  if (await item.isExisting()) {
    await item.click()
  } else {
    // Enter may execute exact match
    await browser.keys('Enter')
  }
  await browser.pause(400)
}

describe('memory slash commands @memory', () => {
  before(async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()
    await waitForHipE2E()
    await switchToChatSurface()
  })

  it('M2.9 /memory opens settings memory page', async () => {
    const newBtn = await browser.$('[data-testid="new-session-button"]')
    if (await newBtn.isExisting()) {
      await newBtn.click()
      await chat.newConversation.waitForExist({ timeout: 10000 })
    }

    await runSlash('memory')

    await browser.waitUntil(
      async () => {
        const empty = await browser.$('[data-testid="memory-config-empty"]')
        const panel = await browser.$('[data-testid="memory-config"]')
        return (await empty.isExisting()) || (await panel.isExisting())
      },
      { timeout: 15000, interval: 300, timeoutMsg: '/memory did not open memory settings' },
    )

    const back = await browser.$('[data-testid="settings-back"]')
    if (await back.isExisting()) await back.click()
  })

  it('M2.10 /memory-on and /memory-off toggle useMemories flag', async () => {
    await switchToChatSurface()
    const sessionId = await createChatSessionForE2e()
    expect(sessionId).toBeTruthy()

    await browser.waitUntil(
      async () => (await (await browser.$$('[data-testid="session-tab"]')).length) >= 1,
      { timeout: 20000, interval: 300 },
    )

    await runSlash('memory-on')
    await browser.waitUntil(
      async () => {
        const flags = await getActiveSessionMemoryFlags()
        return flags?.useMemories === true
      },
      { timeout: 10000, interval: 200, timeoutMsg: 'useMemories not true after /memory-on' },
    )

    await runSlash('memory-off')
    await browser.waitUntil(
      async () => {
        const flags = await getActiveSessionMemoryFlags()
        return flags?.useMemories === false
      },
      { timeout: 10000, interval: 200, timeoutMsg: 'useMemories not false after /memory-off' },
    )
  })
})
