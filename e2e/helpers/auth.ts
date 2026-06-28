export async function skipLoginIfPresent(): Promise<void> {
  const skip = await browser.$('button=跳过登录')
  if (await skip.isExisting()) {
    await skip.click()
    await browser.waitUntil(
      async () => (await browser.getUrl()).includes('#/app'),
      { timeout: 10000, interval: 200 }
    )
  }
}
