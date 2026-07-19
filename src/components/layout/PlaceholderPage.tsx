import { useTranslation } from 'react-i18next'
import { Construction } from 'lucide-react'

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
    <div
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-8 py-12 text-center"
      data-testid={testId}
      role="status"
    >
      <div
        className="flex size-12 items-center justify-center rounded-2xl bg-surface-muted text-ink-tertiary"
        aria-hidden
      >
        <Construction size={24} strokeWidth={1.75} />
      </div>
      <div className="flex max-w-md flex-col gap-2">
        <h1 className="text-lg font-semibold tracking-tight text-ink">{t(titleKey)}</h1>
        <p className="text-body text-ink-secondary">{t(descriptionKey)}</p>
      </div>
    </div>
  )
}
