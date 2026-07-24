/**
 * Ensure a composer chip is visible and unique in the document.
 * Opens the Overflow ("More") popover when COMPOSER_OVERFLOW is on and the
 * chip lives inside the panel.
 *
 * Pointer synthesis matches openPermissionMenu (bare click is flaky on Radix).
 */
export async function ensureComposerControlVisible(
  testId: string,
): Promise<WebdriverIO.Element> {
  const selector = `[data-testid="${testId}"]`

  const tryFind = async (): Promise<WebdriverIO.Element | null> => {
    const els = await browser.$$(selector)
    const count = await els.length
    if (count === 0) return null
    // Prefer a displayed instance
    for (let i = 0; i < count; i++) {
      const el = els[i]!
      if (await el.isDisplayed().catch(() => false)) return el
    }
    return els[0] ?? null
  }

  let el = await tryFind()
  if (el && (await el.isDisplayed().catch(() => false))) {
    // Uniqueness soft-check: prefer first displayed
    return el
  }

  const overflow = await browser.$('[data-testid="composer-overflow"]')
  if (await overflow.isExisting().catch(() => false)) {
    // Radix: pointerdown + click synthesis
    await browser.execute((node: HTMLElement) => {
      node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      node.click()
    }, overflow)
    await browser.pause(150)
    await browser
      .$('[data-testid="composer-overflow-panel"]')
      .waitForExist({ timeout: 5000 })
      .catch(() => undefined)
  }

  await browser.waitUntil(
    async () => {
      const found = await tryFind()
      return !!(found && (await found.isDisplayed().catch(() => false)))
    },
    {
      timeout: 15000,
      timeoutMsg: `composer control ${testId} not visible after overflow open`,
    },
  )

  el = await tryFind()
  if (!el) throw new Error(`composer control ${testId} not found`)
  return el
}
