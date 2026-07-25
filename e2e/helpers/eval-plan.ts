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

/** Sticky plan checklist / progress panel (forcePlan, write_todos, or approval). */
export async function planProgressPanelVisible(): Promise<boolean> {
  try {
    return await browser.execute(() =>
      Boolean(document.querySelector('[data-testid="plan-progress-panel"]')),
    )
  } catch {
    return false
  }
}

/**
 * Click product Plan mode until active (draft or session executionMode=plan / forcePlan).
 * Supports ExecutionModePicker (menu) and legacy binary plan-mode-chip.
 */
export async function enablePlanModeUi(): Promise<void> {
  const { ensureComposerControlVisible } = await import('./composer-overflow')

  // Prefer three-mode picker
  try {
    const chip = await ensureComposerControlVisible('execution-mode-chip')
    const pressed = await chip.getAttribute('aria-pressed')
    // When plan/autopilot is active, chip is pressed; still need plan specifically.
    await browser.execute((el: HTMLElement) => el.click(), chip)
    await browser.pause(150)
    const planItem = await browser.$('[data-testid="execution-mode-plan"]')
    if (await planItem.isExisting()) {
      await planItem.click()
      await browser.pause(200)
      return
    }
    // Menu failed; if already pressed treat as success
    if (pressed === 'true') return
  } catch {
    // fall through to legacy chip
  }

  const chip = await ensureComposerControlVisible('plan-mode-chip')
  const pressed = await chip.getAttribute('aria-pressed')
  if (pressed === 'true') return
  await browser.execute((el: HTMLElement) => el.click(), chip)
  await browser.pause(200)
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
