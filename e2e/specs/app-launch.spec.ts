import { expect } from 'expect-webdriverio'

describe('hip desktop app', () => {
  it('should launch and show login screen', async () => {
    await browser.pause(3000)

    const url = await browser.getUrl()
    expect(url).toContain('#/login')

    const heading = await browser.$('h1')
    await heading.waitForDisplayed({ timeout: 10000 })

    const text = await heading.getText()
    expect(text).toContain('hip')
  })

  it('should navigate to main app and render chat interface', async () => {
    const skipBtn = await browser.$('button=跳过登录')
    await skipBtn.waitForDisplayed({ timeout: 5000 })
    await browser.execute((el: HTMLElement) => el.click(), await skipBtn as unknown as HTMLElement)

    await browser.waitUntil(
      async () => {
        const url = await browser.getUrl()
        return url.includes('#/app')
      },
      { timeout: 10000, interval: 200 }
    )

    await browser.pause(3000)

    const url = await browser.getUrl()
    expect(url).toContain('#/app')

    const root = await browser.$('#root')
    const rootText = await root.getText()

    expect(rootText).toContain('重构 WebSocket 客户端')
    expect(rootText).toContain('hip')
  })
})
