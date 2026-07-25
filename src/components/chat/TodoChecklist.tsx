import { useTranslation } from 'react-i18next'
import { Circle, CircleDot, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Todo } from '@/lib/todos'

const TODO_ICON = {
  pending: Circle,
  in_progress: CircleDot,
  completed: CheckCircle2,
} as const

const TODO_ICON_CLASS = {
  pending: 'text-ink-tertiary',
  in_progress: 'text-accent-strong',
  completed: 'text-success',
} as const

export function TodoChecklist({
  todos,
  showHeading = true,
  compact = false,
}: {
  todos: Todo[]
  /** When false, omit the "Plan" caption (parent panel supplies the header). */
  showHeading?: boolean
  /** Embedded in PlanProgressPanel: no extra chrome so the sticky bar stays slim. */
  compact?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        !compact && 'rounded-md border border-border bg-surface-muted/40 px-2 py-1.5',
      )}
      data-testid="todo-checklist"
    >
      {showHeading && (
        <div className="mb-1 text-caption font-medium text-ink-tertiary">{t('chat.todos.plan')}</div>
      )}
      <ul className="flex flex-col gap-0.5">
        {todos.map((todo, i) => {
          const Icon = TODO_ICON[todo.status]
          return (
            <li
              key={i}
              className={cn(
                'flex items-center gap-[var(--meta-gap)] text-meta leading-5',
                compact ? 'min-h-5' : 'min-h-[var(--trail-min-h)]',
              )}
              data-status={todo.status}
            >
              <Icon
                size={compact ? 12 : 14}
                className={cn('block shrink-0', TODO_ICON_CLASS[todo.status])}
                aria-label={t(`chat.todos.${todo.status}`)}
              />
              <span
                className={cn(
                  'min-w-0 truncate',
                  todo.status === 'completed' ? 'text-ink-tertiary line-through' : 'text-ink-secondary',
                )}
              >
                {todo.content}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
