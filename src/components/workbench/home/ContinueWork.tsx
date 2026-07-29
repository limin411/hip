import { MessageSquarePlus, Play } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { sessionService, useDomainStore } from '@/domain'
import { enterSection } from '@/components/layout/sidebarActions'
import { formatRelativeTime } from '@/lib/datetime'
import { surfaceOf } from '@/lib/sessions'

/** Primary resume strip — Notion / Cursor “continue where you left off”. */
export function ContinueWork() {
  const { t, i18n } = useTranslation()
  const sessions = useDomainStore((s) => s.sessions)

  const latest = [...sessions].sort((a, b) => b.updatedAtMs - a.updatedAtMs)[0] ?? null

  if (!latest) {
    return (
      <section
        className="wb-continue"
        aria-label={t('workbench.continue.title')}
        data-testid="workbench-continue"
      >
        <button
          type="button"
          className="wb-continue-card wb-continue-card--empty"
          data-testid="workbench-continue-empty"
          onClick={() => void enterSection('chats')}
        >
          <span className="wb-continue-icon" aria-hidden>
            <MessageSquarePlus size={22} strokeWidth={1.75} />
          </span>
          <span className="wb-continue-body">
            <span className="wb-continue-kicker">{t('workbench.continue.title')}</span>
            <span className="wb-continue-title">{t('workbench.continue.emptyTitle')}</span>
            <span className="wb-continue-meta">{t('workbench.continue.emptyHint')}</span>
          </span>
          <span className="wb-continue-cta">{t('workbench.continue.startNew')}</span>
        </button>
      </section>
    )
  }

  const surface = surfaceOf(latest.config)
  const rel = formatRelativeTime(latest.updatedAtMs, i18n.language)

  return (
    <section
      className="wb-continue"
      aria-label={t('workbench.continue.title')}
      data-testid="workbench-continue"
    >
      <button
        type="button"
        className="wb-continue-card"
        data-testid="workbench-continue-session"
        onClick={() => {
          sessionService.selectSession(latest.id)
        }}
      >
        <span className="wb-continue-icon" aria-hidden>
          <Play size={20} strokeWidth={1.75} />
        </span>
        <span className="wb-continue-body">
          <span className="wb-continue-kicker">{t('workbench.continue.title')}</span>
          <span className="wb-continue-title">{latest.title || t('workbench.continue.untitled')}</span>
          <span className="wb-continue-meta">
            {t(`workbench.continue.surface.${surface}`)}
            <span className="wb-continue-dot" aria-hidden>
              ·
            </span>
            {rel}
            {latest.status === 'running' && (
              <>
                <span className="wb-continue-dot" aria-hidden>
                  ·
                </span>
                <span className="wb-continue-live">{t('workbench.state.running')}</span>
              </>
            )}
          </span>
        </span>
        <span className="wb-continue-cta">{t('workbench.continue.resume')}</span>
      </button>
    </section>
  )
}
