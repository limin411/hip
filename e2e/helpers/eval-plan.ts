/**
 * Plan-mode helpers for capability-matrix eval (PlanApprovalCard).
 */

export async function planApprovalVisible(): Promise<boolean> {
  const card = await browser.$('[data-testid="plan-approval-card"]')
  return card.isExisting()
}

/** Click plan approve if the card is present. Returns true if clicked. */
export async function approvePlanIfPresent(): Promise<boolean> {
  if (!(await planApprovalVisible())) return false
  const btn = await browser.$('[data-testid="plan-approve"]')
  if (!(await btn.isExisting())) return false
  await browser.execute((el: HTMLElement) => el.click(), btn)
  await browser.pause(300)
  return true
}

/**
 * Best-effort: try to surface plan mode via permission chip / slash is product-dependent.
 * For prefer/require we document that the agent (or seed) must show PlanApprovalCard;
 * this helper only approves when visible.
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
