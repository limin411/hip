import { useTranslation } from 'react-i18next'
import { Check, AlertTriangle } from 'lucide-react'
import type { CatalogModel } from '@/ipc/catalog'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { modelBadges, type ModelCapKey } from '@/lib/modelBadges'

const CAP_I18N = {
  reasoning: 'settings.modelConfig.reasoning',
  tool_call: 'settings.modelConfig.tools',
  attachment: 'settings.modelConfig.vision',
} as const satisfies Record<ModelCapKey, string>

/** Hero card summarising the current (active) model. Renders an empty state when none is set. */
export function CurrentModelHero({
  providerName,
  modelID,
  model,
  keyConfigured,
}: {
  providerName: string | null
  modelID: string | null
  model: CatalogModel | undefined
  keyConfigured: boolean
}) {
  const { t } = useTranslation()

  if (!modelID || !providerName) {
    return (
      <div className="mb-4 rounded-lg border border-dashed border-border bg-surface-subtle px-4 py-3.5">
        <div className="text-body text-ink-secondary">{t('settings.modelConfig.noModel')}</div>
        <div className="mt-0.5 text-meta text-ink-tertiary">{t('settings.modelConfig.noModelHint')}</div>
      </div>
    )
  }

  const badges = model ? modelBadges(model) : null
  return (
    <div className="mb-4 flex items-center gap-3.5 rounded-lg border border-border bg-surface px-4 py-3">
      <Avatar name={providerName} shape="square" size={40} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-body font-medium text-ink">{modelID}</div>
        <div className="mt-0.5 text-meta text-ink-tertiary">
          {providerName} · {t('settings.modelConfig.currentModel')}
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
        <span className="flex shrink-0 items-center gap-1 rounded-md bg-success/10 px-2 py-1 text-caption text-success">
          <Check size={12} /> {t('settings.modelConfig.ready')}
        </span>
      ) : (
        <span className="flex shrink-0 items-center gap-1 rounded-md bg-warning/10 px-2 py-1 text-caption text-warning">
          <AlertTriangle size={12} /> {t('settings.modelConfig.keyMissing')}
        </span>
      )}
    </div>
  )
}
