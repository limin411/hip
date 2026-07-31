/**
 * Open / select ArtifactPanel tabs.
 *
 * When the right rail is open, tabs live in the panel titlebar (`panel-tab-bar`).
 * When collapsed, open via the toolbar PanelToggle Radix DropdownMenu
 * (focus + Enter first, then pointer-event fallback — titlebar drag regions
 * swallow naive clicks under Tauri WDIO).
 */

async function panelTabBarOpen(): Promise<boolean> {
  const bar = await browser.$('[data-testid="panel-tab-bar"]')
  return bar.isExisting()
}

async function panelMenuOpen(): Promise<boolean> {
  const menu = await browser.$('[data-testid="panel-tab-menu"]')
  return menu.isExisting()
}

/** Open the panel tab dropdown (collapsed toolbar); no-op if already open. */
export async function openPanelMenu(): Promise<void> {
  if (await panelMenuOpen()) return

  const toggle = await browser.$('[data-testid="toggle-panel"]')
  await toggle.waitForExist({ timeout: 30000 })

  for (let attempt = 0; attempt < 4; attempt++) {
    // Prefer keyboard: Radix opens on Enter/Space when the trigger is focused.
    await browser.execute((el: HTMLElement) => {
      el.focus()
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }, toggle)
    await browser.pause(50)
    await browser.keys('Enter')

    try {
      await (await browser.$('[data-testid="panel-tab-menu"]')).waitForExist({ timeout: 1200 })
      return
    } catch {
      // Fall through to pointer synthesis.
    }

    try {
      await browser.execute((el: HTMLElement) => {
        const rect = el.getBoundingClientRect()
        const x = rect.left + rect.width / 2
        const y = rect.top + rect.height / 2
        el.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            pointerType: 'mouse',
            clientX: x,
            clientY: y,
            button: 0,
          }),
        )
        el.dispatchEvent(
          new PointerEvent('pointerup', {
            bubbles: true,
            cancelable: true,
            pointerType: 'mouse',
            clientX: x,
            clientY: y,
            button: 0,
          }),
        )
        el.dispatchEvent(
          new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            button: 0,
          }),
        )
      }, toggle)
      await (await browser.$('[data-testid="panel-tab-menu"]')).waitForExist({ timeout: 1200 })
      return
    } catch {
      // Space as second keyboard attempt (some hosts map Enter poorly).
      await browser.execute((el: HTMLElement) => el.focus(), toggle)
      await browser.keys(' ')
      try {
        await (await browser.$('[data-testid="panel-tab-menu"]')).waitForExist({ timeout: 800 })
        return
      } catch {
        // Next outer retry.
      }
    }
  }

  throw new Error('panel-tab-menu did not open after retries (toggle-panel Radix dropdown)')
}

/** Close menu if open (Escape). No-op when using the always-visible tab bar. */
export async function closePanelMenu(): Promise<void> {
  if (!(await panelMenuOpen())) return
  await browser.keys('Escape')
  await browser.waitUntil(async () => !(await panelMenuOpen()), {
    timeout: 3000,
    interval: 100,
  })
}

/**
 * Select a panel tab (files | agents | terminal | …).
 * Uses the titlebar tab bar when the rail is open; otherwise the toolbar menu
 * (which also opens the panel via setSession*PanelOpen).
 */
export async function selectPanelTab(tab: string): Promise<void> {
  const testid = `panel-tab-${tab}`

  if (await panelTabBarOpen()) {
    const item = await browser.$(`[data-testid="panel-tab-bar"] [data-testid="${testid}"]`)
    try {
      await item.waitForExist({ timeout: 5000 })
    } catch {
      const labels = await browser.execute(() =>
        Array.from(document.querySelectorAll('[data-testid="panel-tab-bar"] [data-testid^="panel-tab-"]'))
          .map((el) => el.getAttribute('data-testid'))
          .filter(Boolean),
      )
      throw new Error(`${testid} not found on panel-tab-bar; tabs: ${JSON.stringify(labels)}`)
    }
    await browser.execute((el: HTMLElement) => el.click(), item)
    await browser.$(`[data-testid="panel-view-${tab}"]`).waitForExist({ timeout: 15000 })
    return
  }

  await openPanelMenu()
  const item = await browser.$(`[data-testid="${testid}"]`)
  try {
    await item.waitForExist({ timeout: 5000 })
  } catch {
    const labels = await browser.execute(() =>
      Array.from(document.querySelectorAll('[data-testid^="panel-tab-"]'))
        .map((el) => el.getAttribute('data-testid'))
        .filter(Boolean),
    )
    throw new Error(`${testid} not found; menu items: ${JSON.stringify(labels)}`)
  }
  await browser.execute((el: HTMLElement) => el.click(), item)
  await browser.$(`[data-testid="panel-view-${tab}"]`).waitForExist({ timeout: 15000 })
}

/**
 * List available panel tab data-testid values.
 * Prefers the open tab bar; falls back to the collapsed toolbar menu.
 */
export async function listPanelMenuTabs(): Promise<string[]> {
  if (await panelTabBarOpen()) {
    return browser.execute(() =>
      Array.from(document.querySelectorAll('[data-testid="panel-tab-bar"] [data-testid^="panel-tab-"]'))
        .map((el) => el.getAttribute('data-testid') ?? '')
        .filter(Boolean),
    )
  }
  await openPanelMenu()
  return browser.execute(() =>
    Array.from(document.querySelectorAll('[data-testid="panel-tab-menu"] [data-testid^="panel-tab-"]'))
      .map((el) => el.getAttribute('data-testid') ?? '')
      .filter(Boolean),
  )
}
