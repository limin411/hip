import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { Square } from 'lucide-react'
import type { TaskSnapshot } from '@hip/protocol'
import { useActiveSessionId, sessionService } from '@/domain'
import { useTaskRuntimeStore, isKnownTaskKind } from '@/store/taskRuntimeStore'
import { cn } from '@/lib/utils'
import { COMPOSER_COLUMN_CLASS } from './ChatColumn'

function statusDot(status: TaskSnapshot['status']): string {
  if (status === 'running' || status === 'scheduled') return 'bg-accent animate-pulse'
  if (status === 'completed') return 'bg-success'
  if (status === 'failed' || status === 'lost' || status === 'suppressed') return 'bg-danger'
  return 'bg-ink-tertiary'
}

/** Active (running/scheduled) tasks only — finished tasks leave the strip. */
function isActive(task: TaskSnapshot): boolean {
  return task.status === 'running' || task.status === 'scheduled'
}

/**
 * Sticky runtime-task strip above the composer (InputBar), like the plan slot.
 * Replaces the old right-panel Runtime tab: background shell/monitor/schedule
 * tasks stay visible while running, with a stop button per row.
 */
export function RuntimeTaskStrip() {
  const { t } = useTranslation()
  const sessionId = useActiveSessionId()
  const tasks = useTaskRuntimeStore(
    useShallow((s) => (sessionId ? Object.values(s.bySession[sessionId]?.tasks ?? {}) : [])),
  )

  const active = tasks.filter(isActive)
  if (active.length === 0) return null

  return (
    <div className="shrink-0 bg-surface py-1.5" data-testid="runtime-task-strip">
      <div className={cn('px-4', COMPOSER_COLUMN_CLASS)}>
        <div className="flex flex-col gap-1 rounded-md border border-border bg-surface-subtle px-2 py-1">
          {active.map((task) => {
            const kindLabel = isKnownTaskKind(task.kind) ? task.kind : 'other'
            return (
              <div
                key={task.id}
                className="flex items-center gap-2"
                data-testid="runtime-task-row"
              >
                <span
                  className={cn('h-1.5 w-1.5 shrink-0 rounded-full', statusDot(task.status))}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-caption text-ink-secondary">
                  {task.description}
                </span>
                <span className="shrink-0 rounded bg-surface px-1 text-meta text-ink-tertiary">
                  {kindLabel}
                </span>
                <button
                  type="button"
                  className="shrink-0 text-ink-tertiary transition-colors hover:text-danger"
                  title={t('artifact.runtimeStop')}
                  aria-label={t('artifact.runtimeStop')}
                  onClick={() => {
                    if (sessionId) sessionService.stopRuntimeTask(sessionId, task.id, 'user')
                  }}
                >
                  <Square size={12} />
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
