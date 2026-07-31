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
 * Leave Settings / History / Trash (overlays + residual full-page specials)
 * so later specs see main shell chrome. Shared Tauri process retains state.
 * Prefer closeOverlayForE2e; chats-nav only for residual full-page views.
 */
export async function leaveSpecialViewsIfOpen(): Promise<void> {
  try {
    const { closeOverlayForE2e, waitForHipE2E } = await import('./e2e-hooks.js')
    await waitForHipE2E()
    await closeOverlayForE2e()
  } catch {
    // Bridge may be missing in some harnesses
  }

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
    const trashPage = await browser.$('[data-testid="recycle-bin-page"]')
    const historyShell = await browser.$('[data-testid="overlay-shell-history"]')
    const trashShell = await browser.$('[data-testid="overlay-shell-trash"]')
    if (
      !(await settingsPage.isExisting()) &&
      !(await historyPage.isExisting()) &&
      !(await trashPage.isExisting()) &&
      !(await historyShell.isExisting()) &&
      !(await trashShell.isExisting())
    ) {
      break
    }

    // Settings: leave via sidebar back. History/trash: modal-close.
    const settingsBack = await browser.$('[data-testid="settings-sidebar-back"]')
    if (await settingsBack.isExisting()) {
      await browser.execute((el: HTMLElement) => el.click(), settingsBack)
      await browser.pause(200)
      continue
    }
    const modalClose = await browser.$('[data-testid="modal-close"]')
    if (await modalClose.isExisting()) {
      await browser.execute((el: HTMLElement) => el.click(), modalClose)
      await browser.pause(200)
      continue
    }

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
      const trashPage = await browser.$('[data-testid="recycle-bin-page"]')
      const historyShell = await browser.$('[data-testid="overlay-shell-history"]')
      const trashShell = await browser.$('[data-testid="overlay-shell-trash"]')
      return (
        !(await settingsPage.isExisting()) &&
        !(await historyPage.isExisting()) &&
        !(await trashPage.isExisting()) &&
        !(await historyShell.isExisting()) &&
        !(await trashShell.isExisting())
      )
    },
    { timeout: 10000, interval: 200, timeoutMsg: 'still on settings/history/trash after leaveSpecialViewsIfOpen' },
  ).catch(() => {
    // Best-effort: some residual dialogs may keep a special view open.
  })
}
