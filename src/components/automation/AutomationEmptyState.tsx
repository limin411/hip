import { useTranslation } from 'react-i18next'
import { Zap } from 'lucide-react'
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
      className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto p-4"
      data-testid="automation-empty-state"
    >
      <EmptyState
        icon={Zap}
        tier="professional"
        title={t('automation.emptyTitle')}
        description={t('automation.emptyDesc')}
        action={{
          label: t('automation.startCta'),
          onClick: onStartBlank,
        }}
        data-testid="automation-empty-hero"
      />
    </div>
  )
}
