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

/**
 * Leave Settings / History special views so later specs see main shell chrome
 * (new-session, surface switch, composer). Shared Tauri process retains activeView.
 */
export async function leaveSpecialViewsIfOpen(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const back = await browser.$('[data-testid="titlebar-back"]')
    const settingsBack = await browser.$('[data-testid="settings-back"]')
    const btn = (await back.isExisting()) ? back : (await settingsBack.isExisting()) ? settingsBack : null
    if (!btn) break
    await browser.execute((el: HTMLElement) => el.click(), btn)
    await browser.pause(200)
  }
  await browser.waitUntil(
    async () => {
      const back = await browser.$('[data-testid="titlebar-back"]')
      const settingsBack = await browser.$('[data-testid="settings-back"]')
      return !(await back.isExisting()) && !(await settingsBack.isExisting())
    },
    { timeout: 10000, interval: 200, timeoutMsg: 'still on settings/history after leaveSpecialViewsIfOpen' },
  ).catch(() => {
    // Best-effort: some residual dialogs may keep a back affordance.
  })
}
