import { useTranslation } from 'react-i18next'
import { FolderGit2, Zap } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/utils'
import {
  AUTOMATION_TEMPLATES,
  type AutomationTemplate,
} from './templates'

export type AutomationTemplateGridProps = {
  onSelect: (template: AutomationTemplate) => void
  /** Hide skill-bootstrap (used only from skills section). */
  excludeIds?: string[]
  /** Show dashed blank card (default true). Empty state uses hero CTA instead. */
  showBlank?: boolean
  className?: string
}

function cadenceBadgeKey(cadence: AutomationTemplate['cadence']): string {
  return `automation.trigger.${cadence}`
}

export function AutomationTemplateGrid({
  onSelect,
  excludeIds = ['skill-bootstrap'],
  showBlank = true,
  className,
}: AutomationTemplateGridProps) {
  const { t } = useTranslation()
  const templates = AUTOMATION_TEMPLATES.filter((x) => !excludeIds.includes(x.id))

  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3',
        className,
      )}
      data-testid="automation-template-grid"
    >
      {templates.map((tpl) => (
        <button
          key={tpl.id}
          type="button"
          data-testid={`automation-template-${tpl.id}`}
          onClick={() => onSelect(tpl)}
          className={cn(
            'flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-left',
            'transition-colors duration-chrome hover:bg-state-hover',
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-body font-medium text-ink">
              {t(tpl.nameKey as 'automation.templates.dailyStandup.name')}
            </span>
            <div className="flex shrink-0 items-center gap-1">
              {tpl.requiresProject ? (
                <span
                  title={t('automation.templates.requiresProject')}
                  aria-label={t('automation.templates.requiresProject')}
                >
                  <FolderGit2
                    className="h-3.5 w-3.5 text-ink-tertiary"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                </span>
              ) : null}
              <Badge size="sm" variant="default">
                {t(cadenceBadgeKey(tpl.cadence) as 'automation.trigger.daily')}
              </Badge>
            </div>
          </div>
          <p className="line-clamp-2 text-meta text-ink-secondary">
            {t(tpl.descriptionKey as 'automation.templates.dailyStandup.description')}
          </p>
        </button>
      ))}
      {showBlank ? (
        <button
          type="button"
          data-testid="automation-template-blank"
          onClick={() =>
            onSelect({
              id: 'blank',
              nameKey: 'automation.templates.blank.name',
              descriptionKey: 'automation.templates.blank.description',
              cadence: 'manual',
              defaultTrigger: { kind: 'manual' },
              promptKey: 'automation.templates.blank.prompt',
              requiresProject: false,
            })
          }
          className={cn(
            'flex flex-col items-start gap-2 rounded-lg border border-dashed border-border bg-surface/50 p-3 text-left',
            'transition-colors duration-chrome hover:bg-state-hover',
          )}
        >
          <span className="inline-flex items-center gap-1.5 text-body font-medium text-ink">
            <Zap className="h-3.5 w-3.5 text-ink-tertiary" strokeWidth={1.75} aria-hidden />
            {t('automation.templates.blank.name')}
          </span>
          <p className="text-meta text-ink-secondary">
            {t('automation.templates.blank.description')}
          </p>
        </button>
      ) : null}
    </div>
  )
}
