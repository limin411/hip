import { useTranslation } from 'react-i18next'
import { Construction } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'

/** i18n keys used by placeholder pages (typed for strict TFunction). */
export type PlaceholderI18nKey =
  | 'sidebar.nav.workbench'
  | 'sidebar.nav.terminals'
  | 'sidebar.nav.tasks'
  | 'sidebar.nav.automation'
  | 'placeholder.comingSoon'
  | 'placeholder.workbench'
  | 'placeholder.terminals'
  | 'placeholder.tasks'
  | 'placeholder.automation'

/**
 * Shared shell for features that are not implemented yet.
 * Used by workbench / terminal management / task tracking / automation.
 */
export function PlaceholderPage({
  titleKey,
  descriptionKey = 'placeholder.comingSoon',
  testId = 'placeholder-page',
}: {
  titleKey: PlaceholderI18nKey
  descriptionKey?: PlaceholderI18nKey
  testId?: string
}) {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid={testId} role="status">
      <EmptyState
        icon={Construction}
        tier="professional"
        title={t(titleKey)}
        description={t(descriptionKey)}
        className="flex-1"
      />
    </div>
  )
}
