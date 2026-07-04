export async function waitForAppReady(timeoutMs = 60000): Promise<void> {
  await browser.waitUntil(
    async () => (await browser.getUrl()).includes('#/login') || (await browser.getUrl()).includes('#/app'),
    { timeout: timeoutMs, interval: 500 }
  )
  // Wait for the Tauri bridge to be usable.
  await browser.waitUntil(
    async () => {
      try {
        return await browser.execute(() => typeof (window as any).__TAURI_INTERNALS__ !== 'undefined')
      } catch {
        return false
      }
    },
    { timeout: 30000, interval: 500 }
  )
}

export async function waitForMainApp(timeoutMs = 60000): Promise<void> {
  await browser.waitUntil(
    async () => (await browser.getUrl()).includes('#/app'),
    { timeout: timeoutMs, interval: 500 }
  )
  // Wait for main chrome.
  await (await browser.$('[data-testid="titlebar"]')).waitForExist({ timeout: 30000 })
}
