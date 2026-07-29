import { AlertTriangle, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ZoneModel } from '../workbenchTypes'
import { ZONE_ICON } from './icons'

/** Linear triage-style strip — only when zones need care. */
export function NeedsAttention({
  zones,
  onOpen,
}: {
  zones: ZoneModel[]
  onOpen: (zone: ZoneModel) => void
}) {
  const { t } = useTranslation()
  const attention = zones.filter((z) => z.state === 'fail' || z.state === 'blocked')

  if (attention.length === 0) return null

  return (
    <section
      className="wb-attention"
      aria-label={t('workbench.attention.title')}
      data-testid="workbench-attention"
    >
      <h2 className="wb-home-section-label wb-attention-label">
        <AlertTriangle size={12} strokeWidth={2} aria-hidden />
        {t('workbench.attention.title')}
      </h2>
      <ul className="wb-attention-list">
        {attention.map((zone) => {
          const Icon = ZONE_ICON[zone.id]
          const label = t(zone.labelKey)
          const stateLabel = t(`workbench.state.${zone.state}`)
          return (
            <li key={zone.id}>
              <button
                type="button"
                className="wb-attention-row"
                data-testid={`workbench-attention-${zone.id}`}
                data-state={zone.state}
                onClick={() => onOpen(zone)}
                aria-label={`${label}, ${stateLabel}`}
              >
                <span className="wb-attention-icon" aria-hidden>
                  <Icon size={16} strokeWidth={1.75} />
                </span>
                <span className="wb-attention-name">{label}</span>
                <span
                  className={`wb-attention-badge wb-attention-badge--${zone.state === 'fail' ? 'danger' : 'warn'}`}
                >
                  {stateLabel}
                </span>
                <ChevronRight size={14} className="wb-attention-chevron" aria-hidden />
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
