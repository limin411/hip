import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ListTodo, Square, Copy } from 'lucide-react'
import type { TaskKind, TaskSnapshot } from '@hip/protocol'
import { useActiveSessionId } from '@/domain'
import { useTaskRuntimeStore, isKnownTaskKind } from '@/store/taskRuntimeStore'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { sessionService } from '@/domain'

type Filter = 'all' | TaskKind

function statusDot(status: TaskSnapshot['status']): string {
  if (status === 'running' || status === 'scheduled') return 'bg-accent animate-pulse'
  if (status === 'completed') return 'bg-success'
  if (status === 'failed' || status === 'lost' || status === 'suppressed') return 'bg-danger'
  return 'bg-ink-tertiary'
}

export function TasksPanel() {
  const { t } = useTranslation()
  const sessionId = useActiveSessionId()
  const state = useTaskRuntimeStore((s) => (sessionId ? s.bySession[sessionId] : undefined))
  const selectTask = useTaskRuntimeStore((s) => s.selectTask)
  const [filter, setFilter] = useState<Filter>('all')

  const tasks = useMemo(() => {
    const list = Object.values(state?.tasks ?? {})
    list.sort((a, b) => b.updatedAt - a.updatedAt)
    if (filter === 'all') return list
    return list.filter((x) => x.kind === filter)
  }, [state?.tasks, filter])

  const selectedId = state?.selectedTaskId ?? null
  const selected = selectedId ? state?.tasks[selectedId] : undefined
  const events = selectedId ? state?.events[selectedId] ?? [] : []
  const running = state?.runningCounts
  const runningTotal =
    (running?.shell ?? 0) + (running?.agent ?? 0) + (running?.monitor ?? 0) + (running?.schedule ?? 0)

  if (!sessionId) {
    return (
      <div className="flex h-full items-center justify-center p-4" data-testid="runtime-empty">
        <EmptyState icon={ListTodo} title={t('artifact.runtimeEmpty')} description={t('artifact.runtimeEmptyDesc')} />
      </div>
    )
  }

  if (tasks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-4" data-testid="runtime-empty">
        <EmptyState icon={ListTodo} title={t('artifact.runtimeEmpty')} description={t('artifact.runtimeEmptyDesc')} />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="runtime-panel">
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border px-2">
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto text-caption">
          {(['all', 'shell', 'agent', 'monitor', 'schedule'] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              className={cn(
                'rounded px-1.5 py-0.5 text-ink-tertiary hover:text-ink',
                filter === f && 'bg-surface-muted text-ink',
              )}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? t('artifact.runtimeFilterAll') : f}
            </button>
          ))}
        </div>
        {runningTotal > 0 ? (
          <span className="shrink-0 text-caption text-accent" data-testid="runtime-running-badge">
            {runningTotal} running
          </span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <ul className="divide-y divide-border" data-testid="runtime-task-list">
          {tasks.map((task) => {
            const kindLabel = isKnownTaskKind(task.kind) ? task.kind : 'other'
            return (
              <li key={task.id}>
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-start gap-2 px-2.5 py-2 text-left hover:bg-surface-muted',
                    selectedId === task.id && 'bg-surface-muted',
                  )}
                  onClick={() => selectTask(sessionId, task.id)}
                  data-testid="runtime-task-row"
                >
                  <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', statusDot(task.status))} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-caption font-medium text-ink">{task.description}</span>
                      <span className="shrink-0 rounded bg-surface px-1 text-meta text-ink-tertiary">{kindLabel}</span>
                    </div>
                    <div className="truncate text-meta text-ink-tertiary">
                      {task.id} · {task.status}
                      {task.metrics?.lines != null ? ` · ${task.metrics.lines} lines` : ''}
                    </div>
                  </div>
                  {(task.status === 'running' || task.status === 'scheduled') && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0"
                      title={t('artifact.runtimeStop')}
                      onClick={(e) => {
                        e.stopPropagation()
                        sessionService.stopRuntimeTask(sessionId, task.id, 'user')
                      }}
                    >
                      <Square size={14} />
                    </Button>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      {selected ? (
        <div className="flex max-h-[40%] min-h-0 flex-col border-t border-border" data-testid="runtime-detail">
          <div className="flex h-8 shrink-0 items-center justify-between gap-2 px-2">
            <span className="truncate text-caption text-ink-secondary">{selected.id}</span>
            <Button
              variant="ghost"
              size="icon"
              title="Copy id"
              onClick={() => void navigator.clipboard.writeText(selected.id)}
            >
              <Copy size={14} />
            </Button>
          </div>
          <pre className="min-h-0 flex-1 overflow-auto px-2.5 pb-2 font-mono text-meta text-ink-secondary whitespace-pre-wrap">
            {events.length > 0
              ? events.map((e) => e.line).join('\n')
              : selected.logTail || selected.detail || selected.status}
          </pre>
        </div>
      ) : null}
    </div>
  )
}
