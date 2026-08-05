import { useTranslation } from 'react-i18next'
import { Target } from 'lucide-react'
import { useActiveSessionId } from '@/domain'
import { useGoalStore } from '@/store/goalStore'
import { cn } from '@/lib/utils'

/** Sticky goal chrome above the transcript (spec I1). */
export function GoalStatusChip() {
  const { t } = useTranslation()
  const sessionId = useActiveSessionId()
  const goal = useGoalStore((s) => (sessionId ? s.bySession[sessionId] : null))

  if (!goal || goal.status === 'completed') return null

  return (
    <div
      className={cn(
        'mb-0 flex w-full items-center gap-2 border-b px-4 py-1.5 text-meta',
        goal.status === 'active' && 'border-accent/40 bg-accent/5 text-ink',
        goal.status === 'paused' && 'border-border bg-surface-muted text-ink-secondary',
        goal.status === 'blocked' && 'border-warning/40 bg-warning/5 text-ink',
      )}
      data-testid="goal-status-chip"
      data-goal-status={goal.status}
    >
      <Target size={14} className="shrink-0 text-accent" aria-hidden />
      <span className="min-w-0 flex-1 truncate font-medium" title={goal.description}>
        {goal.description}
      </span>
      <span className="shrink-0 capitalize text-caption text-ink-tertiary" data-testid="goal-status-label">
        {goal.status}
        {goal.turns != null && goal.maxTurns != null
          ? ` · ${goal.turns}/${goal.maxTurns}`
          : ''}
        {goal.criteriaTotal != null && goal.criteriaTotal > 0
          ? ` · ✓${goal.criteriaDone ?? 0}/${goal.criteriaTotal}`
          : ''}
        {goal.openTodoCount != null && goal.openTodoCount > 0
          ? ` · ${goal.openTodoCount} open`
          : ''}
        {goal.lastVerifyOk === true ? ' · verify✓' : goal.lastVerifyOk === false ? ' · verify✗' : ''}
      </span>
      <span className="sr-only">{t('chat.goal.aria', { defaultValue: 'Active goal' })}</span>
    </div>
  )
}
