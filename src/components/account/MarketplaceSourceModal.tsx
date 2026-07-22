import { useState } from 'react'
import type { MarketSourceState } from '@hip/protocol'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import { Input } from '@/components/ui/Input'
import type { Translate } from './PluginConfigView'

export function MarketplaceSourceModal({
  open,
  sources,
  refreshing,
  adding,
  onClose,
  onToggle,
  onRefresh,
  onAdd,
  onRemove,
  t,
}: {
  open: boolean
  sources: MarketSourceState[]
  refreshing: boolean
  adding?: boolean
  onClose: () => void
  onToggle: (id: string, enabled: boolean) => void
  onRefresh: (id: string) => void
  onAdd: (gitUrl: string) => Promise<void>
  onRemove: (id: string) => Promise<void>
  t: Translate
}) {
  const [gitUrl, setGitUrl] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)

  const handleAdd = async () => {
    const url = gitUrl.trim()
    if (!url) {
      setFormError(t('settings.plugins.addSourceRequired'))
      return
    }
    setFormError(null)
    try {
      await onAdd(url)
      setGitUrl('')
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleRemove = async (id: string) => {
    setRemovingId(id)
    setFormError(null)
    try {
      await onRemove(id)
      setConfirmRemoveId(null)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err))
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          onClose()
          setFormError(null)
          setConfirmRemoveId(null)
        }
      }}
      title={t('settings.plugins.sourcesTitle')}
      resizable
      defaultSize={{ width: 780, height: 620 }}
      minSize={{ width: 560, height: 420 }}
      storageKey="marketplace-sources"
    >
      <div className="space-y-5 p-6" data-testid="marketplace-sources-modal">
        <p className="text-body leading-relaxed text-ink-secondary">
          {t('settings.plugins.sourcesIntro')}
        </p>

        <div
          className="space-y-3 rounded-xl border border-border bg-surface-subtle/60 p-4"
          data-testid="marketplace-source-add"
        >
          <div>
            <div className="text-body font-medium text-ink">
              {t('settings.plugins.addSourceTitle')}
            </div>
            <p className="mt-1 text-meta leading-relaxed text-ink-tertiary">
              {t('settings.plugins.addSourceHint')}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              className="min-w-0 flex-1 font-mono text-meta"
              value={gitUrl}
              onChange={(e) => setGitUrl(e.target.value)}
              placeholder={t('settings.plugins.addSourcePlaceholder')}
              disabled={adding}
              data-testid="marketplace-source-git-url"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void handleAdd()
                }
              }}
            />
            <Button
              variant="primary"
              size="sm"
              className="shrink-0 sm:min-w-[7rem]"
              disabled={adding || !gitUrl.trim()}
              onClick={() => void handleAdd()}
              data-testid="marketplace-source-add-btn"
            >
              {adding ? t('settings.plugins.addingSource') : t('settings.plugins.addSource')}
            </Button>
          </div>
        </div>

        {formError && (
          <div
            className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2.5 text-meta text-danger"
            data-testid="marketplace-source-form-error"
          >
            {formError}
          </div>
        )}

        <div className="space-y-3">
          {sources.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-surface-subtle/40 px-4 py-10 text-center text-body text-ink-tertiary">
              {t('settings.plugins.sourcesEmpty')}
            </div>
          ) : (
            sources.map((src) => {
              const blocked = Boolean(src.hasDownloadedPlugins)
              const confirming = confirmRemoveId === src.id
              return (
                <div
                  key={src.id}
                  className="rounded-xl border border-border bg-surface p-4"
                  data-testid={`marketplace-source-${src.id}`}
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-body font-semibold text-ink">{src.name}</div>
                        {src.builtin && (
                          <span className="rounded-md bg-accent-subtle px-1.5 py-0.5 text-caption font-medium text-accent-strong">
                            {t('settings.plugins.sourceBuiltin')}
                          </span>
                        )}
                        {src.pluginCount != null && (
                          <span className="text-caption text-ink-tertiary">
                            {t('settings.plugins.pluginCount', { count: src.pluginCount })}
                          </span>
                        )}
                      </div>
                      {src.description && (
                        <div className="text-meta leading-relaxed text-ink-secondary">
                          {src.description}
                        </div>
                      )}
                      {src.catalogRepo && (
                        <div className="break-all font-mono text-caption text-ink-tertiary">
                          {src.catalogRepo}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-ink-tertiary">
                        {src.lastFetchedAt && (
                          <span>
                            {t('settings.plugins.lastFetched')}: {src.lastFetchedAt}
                          </span>
                        )}
                        {src.lastError && (
                          <span className="text-danger">{src.lastError}</span>
                        )}
                      </div>
                      {blocked && (
                        <div className="text-caption text-ink-tertiary">
                          {t('settings.plugins.removeSourceBlocked')}
                        </div>
                      )}
                      {confirming && (
                        <div className="mt-1 flex flex-wrap items-center gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2">
                          <span className="text-meta text-ink-secondary">
                            {t('settings.plugins.removeSourceConfirm')}
                          </span>
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={removingId === src.id}
                            onClick={() => void handleRemove(src.id)}
                            data-testid={`marketplace-source-remove-confirm-${src.id}`}
                          >
                            {t('settings.plugins.removeSource')}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setConfirmRemoveId(null)}
                          >
                            {t('settings.plugins.cancel')}
                          </Button>
                        </div>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-row flex-wrap items-center gap-2 sm:flex-col sm:items-end">
                      <div className="flex items-center gap-2 sm:mb-1">
                        <span className="text-caption text-ink-tertiary sm:hidden">
                          {t('settings.plugins.enableSource')}
                        </span>
                        <Switch
                          checked={src.enabled}
                          onCheckedChange={(on) => onToggle(src.id, on)}
                          ariaLabel={t('settings.plugins.enableSource')}
                          data-testid={`marketplace-source-enable-${src.id}`}
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={refreshing || !src.enabled}
                          onClick={() => onRefresh(src.id)}
                          data-testid={`marketplace-source-refresh-${src.id}`}
                        >
                          {t('settings.plugins.refreshSource')}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={blocked || removingId === src.id || confirming}
                          onClick={() => setConfirmRemoveId(src.id)}
                          data-testid={`marketplace-source-remove-${src.id}`}
                          title={
                            blocked
                              ? t('settings.plugins.removeSourceBlocked')
                              : undefined
                          }
                        >
                          {t('settings.plugins.removeSource')}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </Modal>
  )
}
