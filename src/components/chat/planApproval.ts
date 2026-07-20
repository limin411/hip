import type { SessionVM } from '@/domain/sessionStore'

/** True when the session is awaiting plan approval — independent of plan item count. */
export function hasPlanApproval(session: SessionVM | null | undefined): boolean {
  return !!session?.planApprovalPending
}
