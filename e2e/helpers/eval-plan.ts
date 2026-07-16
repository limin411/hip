/**
 * Plan-mode helpers for capability-matrix eval (PlanApprovalCard + product forcePlan entry).
 */

export async function planApprovalVisible(): Promise<boolean> {
  try {
    return await browser.execute(() =>
      Boolean(document.querySelector('[data-testid="plan-approval-card"]')),
    )
  } catch {
    return false
  }
}

/** Click product Plan mode chip until active (draft or session forcePlan). */
export async function enablePlanModeUi(): Promise<void> {
  const chip = await browser.$('[data-testid="plan-mode-chip"]')
  await chip.waitForExist({ timeout: 15000 })
  const pressed = await chip.getAttribute('aria-pressed')
  if (pressed === 'true') return
  await browser.execute((el: HTMLElement) => el.click(), chip)
  await browser.pause(200)
  // If still off (missed click), try once more
  const again = await chip.getAttribute('aria-pressed')
  if (again !== 'true') {
    await browser.execute((el: HTMLElement) => el.click(), chip)
    await browser.pause(200)
  }
}

/**
 * Click plan approve only if the button is present and enabled.
 * Disabled buttons (post-click local state) must not count as new approvals —
 * live eval previously recorded plan_approvals=18 by re-clicking a disabled control.
 */
export async function approvePlanIfPresent(): Promise<boolean> {
  try {
    const clicked = await browser.execute(() => {
      const btn = document.querySelector(
        '[data-testid="plan-approve"]',
      ) as HTMLButtonElement | null
      if (!btn) return false
      if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') return false
      btn.click()
      return true
    })
    if (clicked) await browser.pause(300)
    return Boolean(clicked)
  } catch {
    return false
  }
}

/**
 * Auto-click PlanApprovalCard approve while an enabled approve control is present.
 */
export async function pumpPlanApprovals(maxClicks = 3): Promise<number> {
  let n = 0
  for (let i = 0; i < maxClicks; i++) {
    if (await approvePlanIfPresent()) n += 1
    else break
    await browser.pause(400)
  }
  return n
}
