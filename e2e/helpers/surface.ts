async function dismissSlashPalette(): Promise<void> {
  const palette = await browser.$('[data-testid="slash-palette"]')
  if (await palette.isExisting()) {
    await browser.keys('Escape')
    await palette.waitForExist({ reverse: true, timeout: 5000 })
  }
}

async function openNewSessionMenu(): Promise<void> {
  const button = await browser.$('[data-testid="new-session-button"]')
  await button.waitForExist({ timeout: 20000 })

  try {
    await button.click()
  } catch {
    // Headless WebKit sometimes reports the button as not clickable when an
    // overlay or animation is present; dispatch the pointer events Radix uses.
    await browser.execute((el: HTMLElement) => {
      const rect = el.getBoundingClientRect()
      const x = rect.left + rect.width / 2
      const y = rect.top + rect.height / 2
      el.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', clientX: x, clientY: y }),
      )
      el.dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse', clientX: x, clientY: y }),
      )
      el.click()
    }, button)
  }

  // Wait for the Radix portal to render the menu items.
  await browser.waitUntil(
    async () => (await browser.$('[data-testid="new-session-chat"]')).isExisting(),
    { timeout: 5000, interval: 100, timeoutMsg: 'new-session menu did not open' },
  )
}

async function clickMenuItem(testid: string): Promise<void> {
  const item = await browser.$(`[data-testid="${testid}"]`)
  await item.waitForExist({ timeout: 10000 })
  await browser.execute((el: HTMLElement) => el.click(), item)
}

async function switchToSurface(surface: 'chat' | 'code'): Promise<void> {
  await dismissSlashPalette()
  await openNewSessionMenu()

  const testid = surface === 'code' ? 'new-session-code' : 'new-session-chat'
  await clickMenuItem(testid)

  // Re-query after the surface switch because the DOM may have been recreated.
  await (await browser.$('[data-testid="new-conversation"]')).waitForExist({ timeout: 60000 })
}

export async function switchToCodeSurface(): Promise<void> {
  await switchToSurface('code')
}

export async function switchToChatSurface(): Promise<void> {
  await switchToSurface('chat')
}
