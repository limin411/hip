export async function skipLoginIfPresent(): Promise<void> {
  const url = await browser.getUrl()
  if (url.includes('#/app')) return

  const skip = await browser.$('button=跳过登录')
  await skip.waitForExist({ timeout: 10000 })
  await skip.click()
  await browser.waitUntil(
    async () => (await browser.getUrl()).includes('#/app'),
    { timeout: 10000, interval: 200 }
  )
}
