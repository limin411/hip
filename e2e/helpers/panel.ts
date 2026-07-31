/**
 * Open / select ArtifactPanel tabs.
 *
 * When the right rail is open, tabs live in a right-edge dropdown
 * (`panel-tab-trigger` → portaled `panel-tab-dropdown`).
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

async function panelDropdownOpen(): Promise<boolean> {
  const menu = await browser.$('[data-testid="panel-tab-dropdown"]')
  return menu.isExisting()
}

/** Open a dropdown by focusing its trigger and synthesizing open gestures. */
async function openDropdownFromTrigger(
  triggerTestId: string,
  menuTestId: string,
  label: string,
): Promise<void> {
  if (await browser.$(`[data-testid="${menuTestId}"]`).isExisting()) return

  const toggle = await browser.$(`[data-testid="${triggerTestId}"]`)
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
      await (await browser.$(`[data-testid="${menuTestId}"]`)).waitForExist({ timeout: 1200 })
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
      await (await browser.$(`[data-testid="${menuTestId}"]`)).waitForExist({ timeout: 1200 })
      return
    } catch {
      // Space as second keyboard attempt (some hosts map Enter poorly).
      await browser.execute((el: HTMLElement) => el.focus(), toggle)
      await browser.keys(' ')
      try {
        await (await browser.$(`[data-testid="${menuTestId}"]`)).waitForExist({ timeout: 800 })
        return
      } catch {
        // Next outer retry.
      }
    }
  }

  throw new Error(`${menuTestId} did not open after retries (${label})`)
}

/** Open the panel tab dropdown (collapsed toolbar); no-op if already open. */
export async function openPanelMenu(): Promise<void> {
  await openDropdownFromTrigger('toggle-panel', 'panel-tab-menu', 'toggle-panel Radix dropdown')
}

/** Open the in-panel right-edge tab dropdown; no-op if already open. */
export async function openPanelTabDropdown(): Promise<void> {
  await openDropdownFromTrigger(
    'panel-tab-trigger',
    'panel-tab-dropdown',
    'panel-tab-trigger Radix dropdown',
  )
}

/** Close menu if open (Escape). */
export async function closePanelMenu(): Promise<void> {
  const open = (await panelMenuOpen()) || (await panelDropdownOpen())
  if (!open) return
  await browser.keys('Escape')
  await browser.waitUntil(
    async () => !(await panelMenuOpen()) && !(await panelDropdownOpen()),
    {
      timeout: 3000,
      interval: 100,
    },
  )
}

/**
 * Select a panel tab (files | agents | terminal | …).
 * Uses the titlebar dropdown when the rail is open; otherwise the toolbar menu
 * (which also opens the panel via setSession*PanelOpen).
 */
export async function selectPanelTab(tab: string): Promise<void> {
  const testid = `panel-tab-${tab}`

  if (await panelTabBarOpen()) {
    await openPanelTabDropdown()
    const item = await browser.$(`[data-testid="panel-tab-dropdown"] [data-testid="${testid}"]`)
    try {
      await item.waitForExist({ timeout: 5000 })
    } catch {
      const labels = await browser.execute(() =>
        Array.from(
          document.querySelectorAll('[data-testid="panel-tab-dropdown"] [data-testid^="panel-tab-"]'),
        )
          .map((el) => el.getAttribute('data-testid'))
          .filter(Boolean),
      )
      throw new Error(`${testid} not found on panel-tab-dropdown; tabs: ${JSON.stringify(labels)}`)
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
 * Prefers the open-panel dropdown; falls back to the collapsed toolbar menu.
 */
export async function listPanelMenuTabs(): Promise<string[]> {
  if (await panelTabBarOpen()) {
    await openPanelTabDropdown()
    return browser.execute(() =>
      Array.from(
        document.querySelectorAll('[data-testid="panel-tab-dropdown"] [data-testid^="panel-tab-"]'),
      )
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
