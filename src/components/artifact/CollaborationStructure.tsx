import { useTranslation } from 'react-i18next'
import { ROLE_COLOR, ROLE_NAME_KEY, agentDisplayName } from '@/lib/roleColor'
import type { TurnAgent } from '@/lib/turnAgents'
import { cn } from '@/lib/utils'

/**
 * Lightweight parent→children tree for a turn.
 * Only render when there are sub-agents (D2: hide when supervisor-only).
 * Flat list — no card chrome.
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
    <div className="px-1.5" data-testid="collaboration-structure">
      <div className="mb-1 text-caption font-medium text-ink-tertiary">
        {t('artifact.collaborationStructure')}
      </div>
      <ul className="m-0 flex list-none flex-col p-0">
        <li className="flex items-center gap-2 py-0.5">
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{
              background: supervisor ? ROLE_COLOR[supervisor.role] : 'var(--ink-tertiary)',
            }}
            aria-hidden
          />
          <span className="text-meta font-medium text-ink">{rootLabel}</span>
          {supervisor && live && supervisor.status === 'running' && (
            <span className="text-caption text-accent">{t('artifact.statusRunning')}</span>
          )}
        </li>
        {children.map((child) => {
          const childRunning = live && child.status === 'running'
          return (
            <li key={child.agentId} className="flex items-start gap-2 py-0.5 pl-4">
              <span
                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: ROLE_COLOR[child.role] }}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-meta font-medium text-ink">
                    {agentDisplayName(child, t)}
                  </span>
                  <span
                    className={cn(
                      'text-caption',
                      childRunning ? 'text-accent' : 'text-ink-tertiary',
                    )}
                  >
                    {child.status === 'running'
                      ? t('artifact.statusRunning')
                      : child.status === 'error'
                        ? t('artifact.failed')
                        : child.status}
                  </span>
                </div>
                {child.taskInput && (
                  <div
                    className="mt-0.5 truncate text-caption leading-snug text-ink-tertiary"
                    title={child.taskInput}
                  >
                    {child.taskInput}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
