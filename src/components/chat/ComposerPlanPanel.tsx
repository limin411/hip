import { useMemo } from 'react'
import { sessionService, useActiveSession, useActiveMessages, useActiveSessionStatus } from '@/domain'
import { cn } from '@/lib/utils'
import { selectLivePlan } from '@/lib/todos'
import { PlanProgressPanel } from './PlanProgressPanel'
import { CHAT_COLUMN_CLASS } from './ChatColumn'

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
            activeTurnPlanMarkdown: session.activeTurnPlanMarkdown,
            activeTurnPlanPath: session.activeTurnPlanPath,
            activeTurnPlanMarkdownTruncated: session.activeTurnPlanMarkdownTruncated,
          })
        : null,
    [session, messages, status],
  )

  if (!livePlan) return null

  return (
    <div className="shrink-0 bg-surface py-1.5" data-testid="composer-plan-slot">
      <div className={cn('px-4', CHAT_COLUMN_CLASS)}>
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
