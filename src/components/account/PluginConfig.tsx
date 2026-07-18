import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PluginMeta } from '@hip/protocol'
import { usePluginsStore } from '@/store/pluginsStore'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { PluginConfigView, type Translate } from './PluginConfigView'

/**
 * Settings → Plugin Market.
 * Lists plugins scanned from ~/.hip/plugins (plugin.json + optional PLUGIN.md).
 * Install is directory-only — no in-app install UI.
 */
export function PluginConfig() {
  const { t } = useTranslation()
  const { plugins, loaded, load, remove } = usePluginsStore()
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<PluginMeta | null>(null)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  return (
    <>
      <PluginConfigView
        plugins={plugins}
        error={error}
        onDelete={(plugin) => {
          setError(null)
          setDeleting(plugin)
        }}
        t={t as Translate}
      />

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
                    .then(() => setDeleting(null))
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
