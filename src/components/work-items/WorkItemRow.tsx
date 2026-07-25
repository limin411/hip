import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import type { WorkItem } from '@/domain/work-items'
import { cn } from '@/lib/utils'

export interface WorkItemRowProps {
  item: WorkItem
  selected: boolean
  onSelect: () => void
  onToggleComplete: () => void
}

function priorityMetaClass(priority: WorkItem['priority']): string {
  switch (priority) {
    case 'high':
      return 'text-danger'
    case 'medium':
      return 'text-warning'
    case 'low':
      return 'text-ink-secondary'
    default:
      return 'text-ink-tertiary'
  }
}

export function WorkItemRow({ item, selected, onSelect, onToggleComplete }: WorkItemRowProps) {
  const { t } = useTranslation()
  const done = item.status === 'done'
  const cancelled = item.status === 'cancelled'
  const title =
    item.title.trim() || t('workItems.untitled')

  return (
    <div
      role="option"
      aria-selected={selected}
      data-testid={`work-item-row-${item.id}`}
      data-selected={selected ? 'true' : undefined}
      className={cn(
        'group flex w-full cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-chrome',
        selected ? 'bg-state-active' : 'hover:bg-state-hover',
      )}
      onClick={onSelect}
    >
      <button
        type="button"
        data-testid={`work-item-complete-${item.id}`}
        aria-label={done ? t('workItems.actions.reopen') : t('workItems.actions.complete')}
        aria-pressed={done}
        className={cn(
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors duration-chrome',
          done
            ? 'border-success bg-success text-on-accent'
            : 'border-border bg-surface text-transparent hover:border-ink-tertiary',
          cancelled && !done && 'opacity-50',
        )}
        onClick={(e) => {
          e.stopPropagation()
          onToggleComplete()
        }}
      >
        <Check className="h-3 w-3" strokeWidth={2.5} />
      </button>

      <div className="min-w-0 flex-1">
        <div
          className={cn(
            'truncate text-body text-ink',
            (done || cancelled) && 'text-ink-tertiary line-through',
          )}
        >
          {title}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-meta text-ink-tertiary">
          {item.dueOn ? (
            <span data-testid={`work-item-due-${item.id}`}>{item.dueOn}</span>
          ) : null}
          {item.priority !== 'none' ? (
            <span
              data-testid={`work-item-priority-${item.id}`}
              className={priorityMetaClass(item.priority)}
            >
              {t(`workItems.priority.${item.priority}`)}
            </span>
          ) : null}
          {item.status === 'in_progress' ? (
            <span className="text-ink-secondary">{t('workItems.status.in_progress')}</span>
          ) : null}
          {cancelled ? (
            <span>{t('workItems.status.cancelled')}</span>
          ) : null}
        </div>
      </div>
    </div>
  )
}
