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

  // If a previous spec left the menu open, reuse it.
  let chatItem = await browser.$('[data-testid="new-session-chat"]')
  if (await chatItem.isExisting()) return

  // Radix DropdownMenu opens on Enter/Space when the trigger has focus. In the
  // full suite the reused app process can be in states where a single Enter is
  // not enough, so we retry with Enter and a pointer-event fallback.
  for (let attempt = 0; attempt < 3; attempt++) {
    await browser.execute((el: HTMLElement) => {
      el.focus()
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }, button)
    await browser.pause(50)
    await browser.keys('Enter')

    chatItem = await browser.$('[data-testid="new-session-chat"]')
    try {
      await chatItem.waitForExist({ timeout: 1000 })
      return
    } catch {
      // Fallback: synthesise the pointer events Radix uses. This also bypasses
      // the titlebar drag region when native clicks are swallowed.
      try {
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
        chatItem = await browser.$('[data-testid="new-session-chat"]')
        await chatItem.waitForExist({ timeout: 1000 })
        return
      } catch {
        // Next retry.
      }
    }
  }

  throw new Error('new-session menu did not open after retries')
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
