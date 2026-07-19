import { useTranslation } from 'react-i18next'
import { ROLE_COLOR, ROLE_NAME_KEY } from '@/lib/roleColor'
import type { TurnAgent } from '@/lib/turnAgents'
import { cn } from '@/lib/utils'

/**
 * Lightweight parent→children tree for a turn.
 * Only render when there are sub-agents (D2: hide when supervisor-only).
 */
export function CollaborationStructure({
  agents,
  live,
}: {
  agents: TurnAgent[]
  live: boolean
}) {
  const { t } = useTranslation()
  const supervisor = agents.find((a) => a.role === 'supervisor')
  const children = agents.filter((a) => a.role !== 'supervisor')
  if (children.length === 0) return null

  const rootLabel = supervisor
    ? t(ROLE_NAME_KEY[supervisor.role])
    : t('artifact.subAgents')

  return (
    <div
      className="rounded-lg border border-border bg-surface-muted/40 px-3 py-2"
      data-testid="collaboration-structure"
    >
      <div className="mb-1.5 text-caption font-medium text-ink-tertiary">
        {t('artifact.collaborationStructure')}
      </div>
      <div className="flex flex-col gap-1 font-mono text-meta text-ink-secondary">
        <div className="flex items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: supervisor ? ROLE_COLOR[supervisor.role] : 'var(--ink-tertiary)' }}
          />
          <span className="font-semibold text-ink">{rootLabel}</span>
          {supervisor && live && supervisor.status === 'running' && (
            <span className="text-caption text-accent">{t('artifact.statusRunning')}</span>
          )}
        </div>
        {children.map((child, i) => {
          const isLast = i === children.length - 1
          return (
            <div key={child.agentId} className="flex items-start gap-1 pl-1">
              <span className="select-none text-ink-tertiary" aria-hidden>
                {isLast ? '└─' : '├─'}
              </span>
              <span
                className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                style={{ background: ROLE_COLOR[child.role] }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold text-ink">{t(ROLE_NAME_KEY[child.role])}</span>
                  <span
                    className={cn(
                      'text-caption capitalize',
                      live && child.status === 'running' ? 'text-accent' : 'text-ink-tertiary',
                    )}
                  >
                    {child.status}
                  </span>
                </div>
                {child.taskInput && (
                  <div className="mt-0.5 truncate text-caption text-ink-tertiary" title={child.taskInput}>
                    {child.taskInput}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
