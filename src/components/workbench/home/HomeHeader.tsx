import { useTranslation } from 'react-i18next'
import type { HeroModel } from '../workbenchTypes'

export function HomeHeader({
  hero,
  title,
  subtitle,
}: {
  hero: HeroModel
  title: string
  subtitle: string
}) {
  const { t } = useTranslation()

  return (
    <header
      className="wb-home-header"
      aria-label={t('workbench.hero.region')}
      data-testid="workbench-hero"
      data-hero-state={hero.state}
    >
      <p className="wb-home-eyebrow">{t('workbench.home.eyebrow')}</p>
      <h1 className="wb-home-title">{title}</h1>
      <p className="wb-home-sub">{subtitle}</p>

      {hero.runningCount > 0 && (
        <dl className="wb-home-stats" aria-label={t('workbench.metrics.summary')}>
          <div className="wb-home-stat" data-testid="workbench-metric-running">
            <dt>{t('workbench.metrics.running')}</dt>
            <dd>{hero.runningCount}</dd>
          </div>
        </dl>
      )}
    </header>
  )
}
