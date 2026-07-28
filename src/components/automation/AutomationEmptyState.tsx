import { useTranslation } from 'react-i18next'
import { Zap } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { AutomationTemplateGrid } from './AutomationTemplateGrid'
import type { AutomationTemplate } from './templates'

/** Seed used when creating an automation from a skill (editor create mode). */
export type SkillSeedDraft = {
  name: string
  prompt: string
  skillIds: string[]
}

export type AutomationEmptyStateProps = {
  onStartBlank: () => void
  onSelectTemplate: (template: AutomationTemplate) => void
}

export function AutomationEmptyState({
  onStartBlank,
  onSelectTemplate,
}: AutomationEmptyStateProps) {
  const { t } = useTranslation()

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4"
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

      <section className="mx-auto w-full max-w-4xl pb-6">
        <h2 className="mb-2 text-body font-semibold text-ink">
          {t('automation.templatesHeading')}
        </h2>
        <p className="mb-3 text-meta text-ink-tertiary">
          {t('automation.templatesHint')}
        </p>
        <AutomationTemplateGrid onSelect={onSelectTemplate} />
      </section>
    </div>
  )
}
