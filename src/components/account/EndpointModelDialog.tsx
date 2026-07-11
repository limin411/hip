import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MemoryModelRef } from '@hip/protocol'
import type { MemoryEndpointPurpose } from '@/lib/memoryEndpoint'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'

const inputCls =
  'h-9 w-full rounded-md border border-border bg-surface px-2.5 text-body text-ink focus:outline-none focus:ring-2 focus:ring-accent/60'

/**
 * Independent endpoint form for embedding / rerank (base URL + API key + model id).
 * Does not use the chat provider catalog.
 */
export function EndpointModelDialog({
  purpose,
  open,
  existing,
  /** True when the dedicated virtual provider slot already has a key (not a chat provider). */
  virtualKeyConfigured,
  busy,
  onSave,
  onClear,
  onClose,
}: {
  purpose: MemoryEndpointPurpose
  open: boolean
  existing?: MemoryModelRef | null
  virtualKeyConfigured: boolean
  busy?: boolean
  onSave: (draft: { baseURL: string; modelID: string; apiKey: string }) => Promise<void>
  onClear: () => Promise<void>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [baseURL, setBaseURL] = useState('')
  const [modelID, setModelID] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setBaseURL(existing?.baseURL ?? '')
    setModelID(existing?.modelID ?? '')
    setApiKey('')
    setError(null)
  }, [open, existing?.baseURL, existing?.modelID, existing?.providerID])

  const title =
    purpose === 'embedding'
      ? t('settings.modelConfig.endpointDialog.embeddingTitle')
      : t('settings.modelConfig.endpointDialog.rerankTitle')

  // Reuse stored key only if already on the independent virtual slot; legacy chat keys cannot transfer.
  const canReuseStoredKey = virtualKeyConfigured
  const canSave =
    baseURL.trim().length > 0 && modelID.trim().length > 0 && (!!apiKey.trim() || canReuseStoredKey)

  async function submit() {
    if (!canSave) return
    setError(null)
    try {
      await onSave({ baseURL: baseURL.trim(), modelID: modelID.trim(), apiKey: apiKey.trim() })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settings.modelConfig.error'))
    }
  }

  async function clear() {
    setError(null)
    try {
      await onClear()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settings.modelConfig.error'))
    }
  }

  return (
    <Modal open={open} onOpenChange={(o) => { if (!o) onClose() }} title={title}>
      <div className="flex flex-col" data-testid={`endpoint-dialog-${purpose}`}>
        <div className="space-y-3 p-5">
          <p className="text-meta text-ink-tertiary">
            {t(`settings.modelConfig.endpointDialog.${purpose}Intro`)}
          </p>
          <Field label={t('settings.modelConfig.baseUrl')}>
            <input
              className={cn(inputCls, 'font-mono')}
              data-testid={`endpoint-${purpose}-base-url`}
              value={baseURL}
              onChange={(e) => setBaseURL(e.target.value)}
              placeholder="https://api.openai.com/v1"
              autoComplete="off"
            />
          </Field>
          <Field label={t('settings.modelConfig.apiKey')}>
            <input
              className={inputCls}
              data-testid={`endpoint-${purpose}-api-key`}
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={canReuseStoredKey ? t('settings.modelConfig.keyStored') : 'sk-...'}
              autoComplete="off"
            />
          </Field>
          <Field label={t('settings.modelConfig.endpointDialog.modelId')}>
            <input
              className={cn(inputCls, 'font-mono')}
              data-testid={`endpoint-${purpose}-model-id`}
              value={modelID}
              onChange={(e) => setModelID(e.target.value)}
              placeholder={
                purpose === 'embedding' ? 'text-embedding-3-small' : 'rerank-model-id'
              }
              autoComplete="off"
            />
          </Field>
          {error && (
            <div className="text-meta text-danger" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border bg-surface-subtle px-5 py-3">
          <div>
            {existing && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                data-testid={`endpoint-${purpose}-clear`}
                onClick={() => void clear()}
              >
                {t(`settings.modelConfig.purpose.${purpose}.clear`)}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={busy || !canSave}
              data-testid={`endpoint-${purpose}-save`}
              onClick={() => void submit()}
            >
              {t('settings.modelConfig.save')}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-meta text-ink-tertiary">{label}</label>
      {children}
    </div>
  )
}
