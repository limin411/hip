import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { ChevronRight, Square } from 'lucide-react'
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
 * One runtime-task row (ui-enhancement-bui P0-3): expandable detail via
 * `.clip-expand` (grid-rows 0fr↔1fr). Expand toggle and stop button are
 * sibling buttons — no nested interactive elements.
 */
function RuntimeTaskRow({
  task,
  sessionId,
}: {
  task: TaskSnapshot
  sessionId: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const kindLabel = isKnownTaskKind(task.kind) ? task.kind : 'other'
  // Last ~2KB log tail or structured detail — the expandable payload.
  const detail = (task.logTail ?? task.detail ?? '').trim()
  const hasDetail = detail.length > 0

  return (
    <div
      className={cn('rounded-md', open && 'bg-state-hover')}
      data-testid="runtime-task-row"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!hasDetail}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-0.5 text-left transition-colors',
            hasDetail ? 'hover:bg-state-hover' : 'cursor-default',
          )}
          data-testid="runtime-task-toggle"
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
          {hasDetail && (
            <ChevronRight
              size={12}
              className={cn(
                'block shrink-0 text-ink-tertiary transition-transform duration-chrome',
                open && 'rotate-90',
              )}
              aria-hidden
            />
          )}
        </button>
        <button
          type="button"
          className="shrink-0 rounded-md p-0.5 text-ink-tertiary transition-colors hover:bg-state-hover hover:text-danger"
          title={t('artifact.runtimeStop')}
          aria-label={t('artifact.runtimeStop')}
          onClick={() => sessionService.stopRuntimeTask(sessionId, task.id, 'user')}
        >
          <Square size={12} />
        </button>
      </div>
      {hasDetail && (
        <div className={cn('clip-expand', open && 'is-open')}>
          <div className="clip-expand-inner">
            <pre
              className="mx-1 mb-1 mt-0.5 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface px-2 py-1.5 font-mono text-caption leading-relaxed text-ink-secondary"
              data-testid="runtime-task-detail"
            >
              {detail}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Sticky runtime-task strip above the composer (InputBar), like the plan slot.
 * Replaces the old right-panel Runtime tab: background shell/monitor/schedule
 * tasks stay visible while running, with expandable detail + stop per row.
 */
export function RuntimeTaskStrip() {
  const sessionId = useActiveSessionId()
  const tasks = useTaskRuntimeStore(
    useShallow((s) => (sessionId ? Object.values(s.bySession[sessionId]?.tasks ?? {}) : [])),
  )

  const active = tasks.filter(isActive)
  if (active.length === 0 || !sessionId) return null

  return (
    <div className="shrink-0 bg-surface py-1.5" data-testid="runtime-task-strip">
      <div className={cn('px-4', COMPOSER_COLUMN_CLASS)}>
        <div className="flex flex-col gap-1 rounded-md border border-border bg-surface-subtle px-2 py-1">
          {active.map((task) => (
            <RuntimeTaskRow key={task.id} task={task} sessionId={sessionId} />
          ))}
        </div>
      </div>
    </div>
  )
}
