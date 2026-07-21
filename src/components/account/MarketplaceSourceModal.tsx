import type { MarketSourceState } from '@hip/protocol'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import type { Translate } from './PluginConfigView'

export function MarketplaceSourceModal({
  open,
  sources,
  refreshing,
  onClose,
  onToggle,
  onRefresh,
  t,
}: {
  open: boolean
  sources: MarketSourceState[]
  refreshing: boolean
  onClose: () => void
  onToggle: (id: string, enabled: boolean) => void
  onRefresh: (id: string) => void
  t: Translate
}) {
  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
      title={t('settings.plugins.sourcesTitle')}
      className="max-w-lg"
    >
      <div className="space-y-3 p-5" data-testid="marketplace-sources-modal">
        <p className="text-body text-ink-secondary">{t('settings.plugins.sourcesIntro')}</p>
        {sources.map((src) => (
          <div
            key={src.id}
            className="flex items-start gap-3 rounded-lg border border-border bg-surface p-3"
            data-testid={`marketplace-source-${src.id}`}
          >
            <div className="min-w-0 flex-1">
              <div className="text-body font-medium text-ink">{src.name}</div>
              <div className="mt-0.5 text-caption text-ink-tertiary">{src.description}</div>
              {src.lastFetchedAt && (
                <div className="mt-1 text-caption text-ink-tertiary">
                  {t('settings.plugins.lastFetched')}: {src.lastFetchedAt}
                </div>
              )}
              {src.lastError && (
                <div className="mt-1 text-caption text-danger">{src.lastError}</div>
              )}
              {src.pluginCount != null && (
                <div className="mt-1 text-caption text-ink-tertiary">
                  {t('settings.plugins.pluginCount', { count: src.pluginCount })}
                </div>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              <Switch
                checked={src.enabled}
                onCheckedChange={(on) => onToggle(src.id, on)}
                ariaLabel={t('settings.plugins.enableSource')}
                data-testid={`marketplace-source-enable-${src.id}`}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={refreshing || !src.enabled}
                onClick={() => onRefresh(src.id)}
                data-testid={`marketplace-source-refresh-${src.id}`}
              >
                {t('settings.plugins.refreshSource')}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
