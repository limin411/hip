import { MessageSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { sessionService, useDomainStore } from '@/domain'
import { enterSection } from '@/components/layout/sidebarActions'
import { formatRelativeTime } from '@/lib/datetime'
import { surfaceOf } from '@/lib/sessions'

const LIMIT = 6

/** Cursor / Notion style recent list under the fold. */
export function RecentSessions() {
  const { t, i18n } = useTranslation()
  const sessions = useDomainStore((s) => s.sessions)

  const recent = [...sessions]
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
    .slice(0, LIMIT)

  return (
    <section
      className="wb-recent"
      aria-label={t('workbench.recent.title')}
      data-testid="workbench-recent"
    >
      <div className="wb-recent-head">
        <h2 className="wb-home-section-label">{t('workbench.recent.title')}</h2>
        {recent.length > 0 && (
          <button
            type="button"
            className="wb-recent-all"
            onClick={() => void enterSection('chats')}
          >
            {t('workbench.recent.viewAll')}
          </button>
        )}
      </div>

      {recent.length === 0 ? (
        <p className="wb-recent-empty" data-testid="workbench-recent-empty">
          {t('workbench.recent.empty')}
        </p>
      ) : (
        <ul className="wb-recent-list">
          {recent.map((s) => {
            const surface = surfaceOf(s.config)
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className="wb-recent-row"
                  data-testid={`workbench-recent-${s.id}`}
                  data-status={s.status}
                  onClick={() => sessionService.selectSession(s.id)}
                >
                  <span className="wb-recent-icon" aria-hidden>
                    <MessageSquare size={15} strokeWidth={1.75} />
                  </span>
                  <span className="wb-recent-title">
                    {s.title || t('workbench.continue.untitled')}
                  </span>
                  <span className="wb-recent-meta">
                    <span className="wb-recent-surface">
                      {t(`workbench.continue.surface.${surface}`)}
                    </span>
                    <span className="wb-recent-time">
                      {formatRelativeTime(s.updatedAtMs, i18n.language)}
                    </span>
                  </span>
                  {s.status === 'running' && (
                    <span className="wb-recent-live" aria-label={t('workbench.state.running')} />
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
