import type { SessionVM } from '@/domain/sessionStore'

export function hasPlanApproval(session: SessionVM | null | undefined): boolean {
  return !!session?.planApprovalPending && (session?.activeTurnPlan?.length ?? 0) > 0
}
