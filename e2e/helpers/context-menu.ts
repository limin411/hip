/**
 * Right-click / Radix ContextMenu helpers for Tauri WDIO.
 *
 * Native contextmenu is flaky under titlebar drag regions; synthesise
 * pointerdown + contextmenu at the host center (same pattern as surface/panel).
 */

const MENU_CONTENT = '[data-testid="context-menu-content"]'
const CONTROLLED_MENU_CONTENT = '[data-testid="controlled-context-menu-content"]'

export type ContextMenuContentSelector =
  | typeof MENU_CONTENT
  | typeof CONTROLLED_MENU_CONTENT

export function contextMenuItemSelector(itemId: string): string {
  return `[data-testid="context-menu-item-${itemId}"]`
}

export function contextMenuKindSelector(kind: string): string {
  return `[data-context-menu-kind="${kind}"]`
}

/** Dismiss open menu (Escape). No-op if already closed. */
export async function closeContextMenu(): Promise<void> {
  const open = async () =>
    (await (await browser.$(MENU_CONTENT)).isExisting()) ||
    (await (await browser.$(CONTROLLED_MENU_CONTENT)).isExisting())

  if (!(await open())) return
  await browser.keys('Escape')
  await browser.waitUntil(async () => !(await open()), {
    timeout: 5000,
    interval: 100,
    timeoutMsg: 'context menu did not close after Escape',
  })
}

/**
 * Open a declarative (or any host) context menu via synthesised right-click.
 * Retries a few times for Tauri/WebKit flakiness.
 */
export async function openContextMenu(
  hostSelector: string,
  options?: {
    contentSelector?: ContextMenuContentSelector
    timeout?: number
  },
): Promise<void> {
  const contentSelector = options?.contentSelector ?? MENU_CONTENT
  const timeout = options?.timeout ?? 8000

  await closeContextMenu()

  const host = await browser.$(hostSelector)
  await host.waitForExist({ timeout: 20000 })

  for (let attempt = 0; attempt < 4; attempt++) {
    await browser.execute((el: HTMLElement) => {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      const rect = el.getBoundingClientRect()
      const x = rect.left + Math.min(rect.width / 2, Math.max(8, rect.width - 8))
      const y = rect.top + Math.min(rect.height / 2, Math.max(8, rect.height - 8))
      const base = {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 2,
        buttons: 2,
        view: window,
      }
      el.dispatchEvent(
        new PointerEvent('pointerdown', {
          ...base,
          pointerType: 'mouse',
          pointerId: 1,
        }),
      )
      el.dispatchEvent(new MouseEvent('mousedown', base))
      el.dispatchEvent(new MouseEvent('contextmenu', base))
      el.dispatchEvent(
        new PointerEvent('pointerup', {
          ...base,
          pointerType: 'mouse',
          pointerId: 1,
        }),
      )
      el.dispatchEvent(new MouseEvent('mouseup', base))
    }, host)

    try {
      await (await browser.$(contentSelector)).waitForExist({ timeout: attempt === 0 ? 1500 : 2500 })
      return
    } catch {
      // Retry
    }
  }

  throw new Error(
    `context menu did not open for host ${hostSelector} (content ${contentSelector}) within ${timeout}ms`,
  )
}

/** Assert menu content is visible and return listed item ids (from data-testid). */
export async function listContextMenuItemIds(
  contentSelector: ContextMenuContentSelector = MENU_CONTENT,
): Promise<string[]> {
  const content = await browser.$(contentSelector)
  await content.waitForExist({ timeout: 5000 })
  return browser.execute((sel: string) => {
    const root = document.querySelector(sel)
    if (!root) return []
    return Array.from(root.querySelectorAll('[data-testid^="context-menu-item-"]'))
      .map((el) => el.getAttribute('data-testid') ?? '')
      .map((id) => id.replace(/^context-menu-item-/, ''))
      .filter(Boolean)
  }, contentSelector)
}

export async function expectContextMenuItems(
  itemIds: string[],
  contentSelector: ContextMenuContentSelector = MENU_CONTENT,
): Promise<void> {
  for (const id of itemIds) {
    const el = await browser.$(contextMenuItemSelector(id))
    await el.waitForExist({
      timeout: 5000,
      timeoutMsg: `missing context-menu-item-${id} (content ${contentSelector})`,
    })
  }
}

/** Click a menu item by stable id; waits for the menu to dismiss. */
export async function clickContextMenuItem(
  itemId: string,
  options?: {
    contentSelector?: ContextMenuContentSelector
    waitForClose?: boolean
  },
): Promise<void> {
  const contentSelector = options?.contentSelector ?? MENU_CONTENT
  const waitForClose = options?.waitForClose !== false
  const item = await browser.$(contextMenuItemSelector(itemId))
  await item.waitForExist({ timeout: 8000 })
  await browser.execute((el: HTMLElement) => el.click(), item)

  if (waitForClose) {
    await browser.waitUntil(
      async () => !(await (await browser.$(contentSelector)).isExisting()),
      {
        timeout: 8000,
        interval: 100,
        timeoutMsg: `menu still open after selecting ${itemId}`,
      },
    )
  }
}

/** Open host menu and click one item (convenience). */
export async function openAndClickContextMenuItem(
  hostSelector: string,
  itemId: string,
  options?: {
    contentSelector?: ContextMenuContentSelector
  },
): Promise<void> {
  await openContextMenu(hostSelector, {
    contentSelector: options?.contentSelector,
  })
  await clickContextMenuItem(itemId, {
    contentSelector: options?.contentSelector,
  })
}
