import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PluginMeta } from '@hip/protocol'
import { usePluginsStore } from '@/store/pluginsStore'
import { useDomainStore } from '@/domain/sessionStore'
import { wsClient } from '@/ipc/ws-client'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { PluginConfigView, type Translate } from './PluginConfigView'

export function PluginConfig() {
  const { t } = useTranslation()
  const { plugins, loaded, load, remove } = usePluginsStore()
  const pluginInstall = useDomainStore((s) => s.pluginInstall)
  const clearPluginInstall = useDomainStore((s) => s.clearPluginInstall)
  const [showForm, setShowForm] = useState(false)
  const [url, setUrl] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [deleting, setDeleting] = useState<PluginMeta | null>(null)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  useEffect(() => {
    if (!pluginInstall?.result || !submitted) return
    if (pluginInstall.result.ok) {
      void load()
      setShowForm(false)
      setUrl('')
      setSubmitted(false)
      setError(null)
      setSuccess(true)
    } else {
      setSubmitted(false)
      setError(pluginInstall.result.error ?? t('settings.plugins.installError'))
    }
  }, [pluginInstall, submitted, load, t])

  const reset = () => {
    setShowForm(false)
    setUrl('')
    setSubmitted(false)
    setError(null)
    setSuccess(false)
    clearPluginInstall()
  }

  const onShowForm = () => {
    reset()
    setShowForm(true)
  }

  const onSubmit = () => {
    const trimmed = url.trim()
    if (!trimmed) return
    setError(null)
    setSuccess(false)
    setSubmitted(true)
    wsClient.send({ type: 'plugin:install:url', url: trimmed })
  }

  const onRetry = () => {
    setError(null)
    setSubmitted(true)
    wsClient.send({ type: 'plugin:install:url', url: url.trim() })
  }

  return (
    <>
      <PluginConfigView
        plugins={plugins}
        pluginInstall={pluginInstall}
        showForm={showForm}
        url={url}
        submitted={submitted}
        error={error}
        success={success}
        onShowForm={onShowForm}
        onHideForm={reset}
        onUrlChange={setUrl}
        onSubmit={onSubmit}
        onRetry={onRetry}
        onDelete={(plugin) => setDeleting(plugin)}
        t={t as Translate}
      />

      {deleting && (
        <Modal
          open
          onOpenChange={(o) => { if (!o) setDeleting(null) }}
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
