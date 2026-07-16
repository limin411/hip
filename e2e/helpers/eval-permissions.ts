/**
 * Permission modal + permission mode picker helpers for eval e2e.
 */

export async function permissionModalOpen(): Promise<boolean> {
  const modal = await browser.$('[data-testid="permission-modal"]')
  return modal.isExisting()
}

/** Click first allow-ish option if modal is open. */
export async function approvePermissionIfPresent(): Promise<boolean> {
  if (!(await permissionModalOpen())) return false

  // Prefer known allow option ids; fall back to first option button.
  const candidates = [
    'permission-option-allow',
    'permission-option-allow_always',
    'permission-option-allow-once',
    'permission-option-yes',
  ]
  for (const id of candidates) {
    const el = await browser.$(`[data-testid="${id}"]`)
    if (await el.isExisting()) {
      await browser.execute((node: HTMLElement) => node.click(), el)
      await browser.pause(200)
      return true
    }
  }

  const anyOpt = await browser.$('[data-testid^="permission-option-"]')
  if (await anyOpt.isExisting()) {
    await browser.execute((node: HTMLElement) => node.click(), anyOpt)
    await browser.pause(200)
    return true
  }
  return false
}

/**
 * Poll and auto-approve permission modals until deadline.
 * Returns true if a modal was still open at the end (stuck).
 */
export async function pumpPermissionsUntil(
  deadlineMs: number,
  autoApprove: boolean,
): Promise<{ stuck: boolean; approvedCount: number }> {
  let approvedCount = 0
  const start = Date.now()
  while (Date.now() < deadlineMs) {
    if (await permissionModalOpen()) {
      if (!autoApprove) {
        return { stuck: true, approvedCount }
      }
      const ok = await approvePermissionIfPresent()
      if (ok) approvedCount += 1
      else {
        // Modal open but no clickable option yet
        await browser.pause(300)
      }
    } else {
      await browser.pause(400)
    }
    // If nothing pending, brief yield for agent tools
    if (Date.now() - start > 50 && !(await permissionModalOpen())) {
      // continue polling until outer settle decides
    }
  }
  return { stuck: await permissionModalOpen(), approvedCount }
}

/**
 * Open permission chip menu with pointer synthesis (Radix often ignores bare el.click()).
 */
async function openPermissionMenu(): Promise<void> {
  const chip = await browser.$('[data-testid="permission-chip"]')
  await chip.waitForExist({ timeout: 15000 })

  for (let attempt = 0; attempt < 4; attempt++) {
    await browser.execute((el: HTMLElement) => {
      el.focus()
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      const rect = el.getBoundingClientRect()
      const x = rect.left + rect.width / 2
      const y = rect.top + rect.height / 2
      const common = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }
      el.dispatchEvent(new PointerEvent('pointerdown', { ...common, pointerType: 'mouse' }))
      el.dispatchEvent(new PointerEvent('pointerup', { ...common, pointerType: 'mouse' }))
      el.dispatchEvent(new MouseEvent('mousedown', common))
      el.dispatchEvent(new MouseEvent('mouseup', common))
      el.dispatchEvent(new MouseEvent('click', common))
      el.click()
    }, chip)

    // Also try keyboard open (Radix: Enter/Space on focused trigger)
    if (attempt === 1) {
      await browser.keys('Enter')
    }
    if (attempt === 2) {
      await browser.keys(' ')
    }

    const item = await browser.$('[data-testid="permission-mode-edit"]')
    try {
      await item.waitForExist({ timeout: 1500 })
      return
    } catch {
      await browser.pause(200)
    }
  }
  throw new Error('permission mode menu did not open after retries')
}

/** Set permission mode via product chip + menu (draft or session). */
export async function setPermissionModeUi(mode: 'chat' | 'edit' | 'full'): Promise<void> {
  await openPermissionMenu()
  const item = await browser.$(`[data-testid="permission-mode-${mode}"]`)
  await item.waitForExist({ timeout: 5000 })
  await browser.execute((el: HTMLElement) => el.click(), item)
  await browser.pause(150)
}
