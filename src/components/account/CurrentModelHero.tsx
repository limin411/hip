import { useTranslation } from 'react-i18next'
import { Check, AlertTriangle, ArrowRight } from 'lucide-react'
import type { CatalogModel } from '@/ipc/catalog'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { modelBadges, type ModelCapKey } from '@/lib/modelBadges'
import { cn } from '@/lib/utils'

const CAP_I18N = {
  reasoning: 'settings.modelConfig.reasoning',
  tool_call: 'settings.modelConfig.tools',
  attachment: 'settings.modelConfig.vision',
} as const satisfies Record<ModelCapKey, string>

export type ModelPurpose = 'base'

/** Hero card summarising the current (active) model. Renders an empty state when none is set. */
export function CurrentModelHero({
  providerName,
  modelID,
  model,
  keyConfigured,
  onLocate,
  purpose = 'base',
}: {
  providerName: string | null
  modelID: string | null
  model: CatalogModel | undefined
  keyConfigured: boolean
  onLocate?: () => void
  purpose?: ModelPurpose
}) {
  const { t } = useTranslation()

  if (!modelID || !providerName) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface-subtle px-4 py-3.5">
        <div className="text-body text-ink-secondary">{t(`settings.modelConfig.purpose.${purpose}.noModel`)}</div>
        <div className="mt-0.5 text-meta text-ink-tertiary">{t(`settings.modelConfig.purpose.${purpose}.noModelHint`)}</div>
      </div>
    )
  }

  const badges = model ? modelBadges(model) : null
  const content = (
    <>
      <Avatar name={providerName} shape="square" size={40} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-body font-medium text-ink">{modelID}</div>
        <div className="mt-0.5 text-meta text-ink-tertiary">
          {providerName} · {t(`settings.modelConfig.purpose.${purpose}.currentModel`)}
        </div>
        {badges && (badges.contextK !== null || badges.caps.length > 0) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {badges.caps.map((c) => (
              <Badge key={c} className={c === 'reasoning' ? 'bg-accent-subtle text-accent-strong' : undefined}>
                {t(CAP_I18N[c])}
              </Badge>
            ))}
            {badges.contextK !== null && <Badge>{badges.contextK}K</Badge>}
          </div>
        )}
      </div>
      {keyConfigured ? (
        <Badge variant="success" size="sm">
          <Check size={12} /> {t('settings.modelConfig.ready')}
        </Badge>
      ) : (
        <Badge variant="warning" size="sm">
          <AlertTriangle size={12} /> {t('settings.modelConfig.keyMissing')}
        </Badge>
      )}
      {onLocate && (
        <span className="shrink-0 text-ink-tertiary">
          <ArrowRight size={16} />
        </span>
      )}
    </>
  )

  const className = cn(
    'flex w-full items-center gap-3.5 rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors',
    onLocate && 'hover:bg-state-hover',
  )

  return onLocate ? (
    <button type="button" onClick={onLocate} className={className}>
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  )
}
