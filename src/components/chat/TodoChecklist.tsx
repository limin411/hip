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
}: {
  todos: Todo[]
  /** When false, omit the "Plan" caption (parent panel supplies the header). */
  showHeading?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div
      className="rounded-md border border-border bg-surface-muted/40 px-2 py-1.5"
      data-testid="todo-checklist"
    >
      {showHeading && (
        <div className="mb-1 text-caption uppercase tracking-wide text-ink-tertiary">{t('chat.todos.plan')}</div>
      )}
      <ul className="flex flex-col gap-1">
        {todos.map((todo, i) => {
          const Icon = TODO_ICON[todo.status]
          return (
            <li key={i} className="flex items-start gap-1.5" data-status={todo.status}>
              <Icon
                size={13}
                className={cn('mt-0.5 shrink-0', TODO_ICON_CLASS[todo.status])}
                aria-label={t(`chat.todos.${todo.status}`)}
              />
              <span
                className={cn(
                  'min-w-0 flex-1 text-meta',
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
