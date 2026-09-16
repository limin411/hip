import { useTranslation } from 'react-i18next'
import { Zap, Sparkles } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'

export type AutomationEmptyStateProps = {
  onStartBlank: () => void
}

/**
 * Empty catalog: hero CTA (blank) + templates (no duplicate blank card) + skills seed.
 * Page header (title / local-only) lives on AutomationsPage.
 */
export function AutomationEmptyState({
  onStartBlank,
}: AutomationEmptyStateProps) {
  const { t } = useTranslation()

  return (
    <div
      className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto p-8"
      data-testid="automation-empty-state"
    >
      {/* Decorative illustration */}
      <div className="relative mb-8">
        <div className="relative flex h-24 w-24 items-center justify-center rounded-2xl border border-border bg-surface">
          <Zap className="h-10 w-10 text-accent" strokeWidth={1.5} />
          <div className="absolute -right-2 -top-2 flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface">
            <Sparkles className="h-4 w-4 text-warning" strokeWidth={1.75} />
          </div>
        </div>
        {/* Subtle accent glow behind the icon */}
        <div
          className="absolute inset-0 -z-10 rounded-2xl bg-accent/5 blur-xl"
          aria-hidden
        />
      </div>

      <EmptyState
        icon={Zap}
        tier="professional"
        title={t('automation.emptyTitle')}
        description={t('automation.emptyDesc')}
        action={{
          label: t('automation.startCta'),
          onClick: onStartBlank,
        }}
        className="py-0"
        data-testid="automation-empty-hero"
      />

      {/* Feature hints */}
      <div className="mt-8 grid max-w-md grid-cols-1 gap-3 sm:grid-cols-2">
        {[
          {
            title: t('automation.feature.schedule'),
            desc: t('automation.feature.scheduleDesc'),
          },
          {
            title: t('automation.feature.triggers'),
            desc: t('automation.feature.triggersDesc'),
          },
        ].map((feature, i) => (
          <div
            key={i}
            className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-3"
          >
            <p className="text-meta font-medium text-ink">
              {feature.title}
            </p>
            <p className="text-caption text-ink-tertiary">
              {feature.desc}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
