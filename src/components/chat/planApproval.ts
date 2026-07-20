import type { SessionVM } from '@/domain/sessionStore'

/** True when the session is awaiting plan approval — independent of plan item count. */
export function hasPlanApproval(session: SessionVM | null | undefined): boolean {
  return !!session?.planApprovalPending
}

/** True when interrupt context is plan_approval (wire kind). */
export function isPlanApprovalInterrupt(
  interrupt: { context?: string | null; question?: string | null } | null | undefined,
): boolean {
  if (!interrupt) return false
  if (interrupt.question === 'plan_approval') return true
  const ctx = interrupt.context
  if (!ctx) return false
  try {
    return JSON.parse(ctx).kind === 'plan_approval'
  } catch {
    return false
  }
}

/**
 * Hide the generic interrupt banner when plan approval owns the CTA surface (D5.2 / KD-PA-3).
 * Uses pending flag only (no items requirement) + defensive context/token check.
 */
export function shouldHideInterruptForPlanApproval(
  planApprovalPending: boolean | undefined,
  interrupt: { context?: string | null; question?: string | null } | null | undefined,
): boolean {
  return Boolean(planApprovalPending) || isPlanApprovalInterrupt(interrupt)
}
