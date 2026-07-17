export async function waitForAppReady(timeoutMs = 60000): Promise<void> {
  await browser.waitUntil(
    async () => (await browser.getUrl()).includes('#/app'),
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
  // Shell v2: left sidebar + main toolbar (full-width titlebar removed).
  await browser.waitUntil(
    async () => {
      const sidebar = await browser.$('[data-testid="app-sidebar"]')
      const toolbar = await browser.$('[data-testid="main-toolbar"]')
      return (await sidebar.isExisting()) || (await toolbar.isExisting())
    },
    {
      timeout: Math.min(timeoutMs, 30000),
      interval: 200,
      timeoutMsg: 'app-sidebar / main-toolbar not found (shell chrome)',
    },
  )
}

/**
 * Leave Settings / History special views so later specs see main shell chrome
 * (new-session, surface switch, composer). Shared Tauri process retains activeView.
 * Shell v2: special views leave via sidebar nav (no titlebar-back).
 */
export async function leaveSpecialViewsIfOpen(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const back = await browser.$('[data-testid="titlebar-back"]')
    const settingsBack = await browser.$('[data-testid="settings-back"]')
    const toolbarBack = await browser.$('[data-testid="main-toolbar-back"]')
    const legacy =
      (await back.isExisting()) ? back
        : (await settingsBack.isExisting()) ? settingsBack
          : (await toolbarBack.isExisting()) ? toolbarBack
            : null
    if (legacy) {
      await browser.execute((el: HTMLElement) => el.click(), legacy)
      await browser.pause(200)
      continue
    }

    const settingsPage = await browser.$('[data-testid="settings-page"]')
    const historyPage = await browser.$('[data-testid="session-history"]')
    if (!(await settingsPage.isExisting()) && !(await historyPage.isExisting())) break

    const chats = await browser.$('[data-testid="sidebar-nav-chats"]')
    if (await chats.isExisting()) {
      await browser.execute((el: HTMLElement) => el.click(), chats)
      await browser.pause(200)
    } else {
      break
    }
  }
  await browser.waitUntil(
    async () => {
      const settingsPage = await browser.$('[data-testid="settings-page"]')
      const historyPage = await browser.$('[data-testid="session-history"]')
      return !(await settingsPage.isExisting()) && !(await historyPage.isExisting())
    },
    { timeout: 10000, interval: 200, timeoutMsg: 'still on settings/history after leaveSpecialViewsIfOpen' },
  ).catch(() => {
    // Best-effort: some residual dialogs may keep a special view open.
  })
}
