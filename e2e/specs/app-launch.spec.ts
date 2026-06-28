import { expect } from 'expect-webdriverio'
import { waitForAppReady, waitForMainApp } from '../helpers/app.js'
import { skipLoginIfPresent } from '../helpers/auth.js'

const CHAT_GREETINGS = [
  '我们来做点什么？',
  '你好呀！',
  '游啊游',
  '一跃而起！',
  '鼓足干劲！',
  '跳起来！',
  '好开心！',
  '让我想想…',
  '伸个懒腰',
  '哗啦啦',
  '看那边！',
  '哇！！',
  '好困…',
  '生气！',
  '太棒了！',
  '躲猫猫',
  '转圈圈！',
  '翻滚吧！',
]

describe('hip desktop app', () => {
  it('should launch and show the login screen', async () => {
    await waitForAppReady()

    await browser.waitUntil(
      async () => (await browser.getUrl()).includes('#/login'),
      { timeout: 30000, interval: 500 }
    )

    const heading = await browser.$('h1')
    await heading.waitForDisplayed({ timeout: 10000 })

    const text = await heading.getText()
    expect(text).toContain('登录到 hip')
  })

  it('should navigate to the main app and render the chat landing', async () => {
    await waitForAppReady()
    await skipLoginIfPresent()
    await waitForMainApp()

    const landing = await browser.$('[data-testid="new-conversation"]')
    await landing.waitForDisplayed({ timeout: 30000 })

    const greeting = await landing.$('h1')
    // Wait for the animated greeting text to settle rather than relying on
    // WebKit's visibility check, which can report false when CSS animations are
    // throttled in the unfocused Tauri window.
    await browser.waitUntil(
      async () => {
        const text = await greeting.getText()
        return CHAT_GREETINGS.some((g) => text.includes(g))
      },
      { timeout: 10000, interval: 200 }
    )
    const greetingText = await greeting.getText()
    expect(CHAT_GREETINGS.some((g) => greetingText.includes(g))).toBe(true)

    const newChat = await browser.$('button=新建会话')
    await newChat.waitForDisplayed({ timeout: 10000 })
    expect(await newChat.getText()).toContain('新建会话')
  })
})
