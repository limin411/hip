import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PluginMeta } from '@hip/protocol'
import { usePluginsStore } from '@/store/pluginsStore'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { PluginConfigView, PluginViewModal, type Translate } from './PluginConfigView'

/**
 * Settings → Plugin Market.
 * Lists plugins scanned from ~/.hip/plugins (plugin.json + optional PLUGIN.md).
 * View details + enable switch; install is directory-only.
 */
export function PluginConfig() {
  const { t } = useTranslation()
  const { plugins, loaded, load, remove, toggle } = usePluginsStore()
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<PluginMeta | null>(null)
  const [viewing, setViewing] = useState<PluginMeta | null>(null)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  // Keep viewing modal in sync when toggle refreshes plugin list.
  useEffect(() => {
    setViewing((v) => {
      if (!v) return v
      return plugins.find((p) => p.id === v.id) ?? null
    })
  }, [plugins])

  return (
    <>
      <PluginConfigView
        plugins={plugins}
        error={error}
        onDelete={(plugin) => {
          setError(null)
          setDeleting(plugin)
        }}
        onToggle={(plugin, enabled) => {
          setError(null)
          void toggle(plugin.id, enabled).catch((err: Error) => {
            setError(err.message ?? t('settings.plugins.toggleError'))
          })
        }}
        onView={(plugin) => {
          setError(null)
          setViewing(plugin)
        }}
        t={t as Translate}
      />

      {viewing && (
        <PluginViewModal
          plugin={viewing}
          onClose={() => setViewing(null)}
          t={t as Translate}
        />
      )}

      {deleting && (
        <Modal
          open
          onOpenChange={(o) => {
            if (!o) setDeleting(null)
          }}
          title={t('settings.plugins.deleteConfirmTitle', { name: deleting.name })}
          className="max-w-sm"
        >
          <div className="p-5">
            <p className="text-body text-ink-secondary">{t('settings.plugins.deleteConfirmBody')}</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setDeleting(null)}>
                {t('settings.plugins.cancel')}
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  remove(deleting.id)
                    .then(() => {
                      if (viewing?.id === deleting.id) setViewing(null)
                      setDeleting(null)
                    })
                    .catch((err: Error) => {
                      setDeleting(null)
                      setError(err.message ?? t('settings.plugins.deleteError'))
                    })
                }}
              >
                {t('settings.plugins.uninstall')}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
