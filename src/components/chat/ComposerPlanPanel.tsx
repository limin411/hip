import { useMemo } from 'react'
import { sessionService, useActiveSession, useActiveMessages, useActiveSessionStatus } from '@/domain'
import { selectLivePlan } from '@/lib/todos'
import { PlanProgressPanel } from './PlanProgressPanel'

/**
 * Sticky plan/todo checklist above the composer (InputBar).
 * Keeps the live plan visible without scrolling the message list.
 */
export function ComposerPlanPanel() {
  const session = useActiveSession()
  const messages = useActiveMessages()
  const status = useActiveSessionStatus()

  const livePlan = useMemo(
    () =>
      session
        ? selectLivePlan({
            messages,
            status,
            forcePlan: Boolean(session.config.forcePlan),
            planApprovalPending: session.planApprovalPending,
            activeTurnPlan: session.activeTurnPlan,
          })
        : null,
    [session, messages, status],
  )

  if (!livePlan) return null

  return (
    <div className="shrink-0 border-t border-border bg-surface px-4 py-2" data-testid="composer-plan-slot">
      <div className="w-full">
        <PlanProgressPanel
          view={livePlan}
          onApprove={() => sessionService.respondPlan('approve')}
          onReject={() => sessionService.respondPlan('reject')}
          onAmend={(content) => sessionService.respondPlan('amend', content)}
        />
      </div>
    </div>
  )
}
