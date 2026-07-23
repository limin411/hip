import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProviderApiKind } from '@hip/protocol'
import { useProvidersStore } from '@/store/providersStore'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { inputClassName } from '@/components/ui/Input'
import { cn } from '@/lib/utils'

const inputCls = inputClassName

/** Modal form to register a custom OpenAI-compatible or Anthropic Messages provider. */
export function AddProviderDialog({ onDone, onCancel }: { onDone: (id: string) => void; onCancel: () => void }) {
  const { t } = useTranslation()
  const addCustom = useProvidersStore((s) => s.addCustom)
  const [name, setName] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [key, setKey] = useState('')
  const [models, setModels] = useState('')
  const [apiKind, setApiKind] = useState<ProviderApiKind>('openai')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    if (!id || !baseURL.trim()) return
    setBusy(true)
    setError(null)
    try {
      const ids = models.split(',').map((m) => m.trim()).filter(Boolean)
      // Connect flow: register → optional key (hot path, no restart) → detail pane.
      await addCustom(id, name.trim(), baseURL.trim(), ids, apiKind)
      if (key.trim()) await useProvidersStore.getState().saveKey(id, key.trim())
      onDone(id)
    } catch (e) {
      console.error('[modelConfig]', e)
      setError(t('settings.modelConfig.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onOpenChange={(o) => { if (!o) onCancel() }} title={t('settings.modelConfig.addCustom')}>
      <div className="flex flex-col">
        <div className="space-y-3 p-5">
          <p className="text-meta text-ink-tertiary">{t('settings.modelConfig.addCustomHint')}</p>
          <Field label={t('settings.modelConfig.customName')}>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="My Provider" />
          </Field>
          <Field label={t('settings.modelConfig.apiKind')}>
            <select
              className={cn(inputCls, 'cursor-pointer')}
              value={apiKind}
              onChange={(e) => setApiKind(e.target.value as ProviderApiKind)}
              data-testid="add-provider-api-kind"
            >
              <option value="openai">{t('settings.modelConfig.apiKindOpenAI')}</option>
              <option value="anthropic">{t('settings.modelConfig.apiKindAnthropic')}</option>
            </select>
          </Field>
          <Field label={t('settings.modelConfig.baseUrl')}>
            <input
              className={cn(inputCls, 'font-mono')}
              value={baseURL}
              onChange={(e) => setBaseURL(e.target.value)}
              placeholder={
                apiKind === 'anthropic'
                  ? 'https://api.example.com/anthropic/v1'
                  : 'https://api.example.com/v1'
              }
            />
          </Field>
          <Field label={t('settings.modelConfig.apiKey')}>
            <input className={inputCls} type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-..." />
          </Field>
          <Field label={t('settings.modelConfig.customModels')}>
            <input
              className={inputCls}
              value={models}
              onChange={(e) => setModels(e.target.value)}
              placeholder={apiKind === 'anthropic' ? 'claude-sonnet-4-5, …' : 'gpt-4o, gpt-4o-mini'}
            />
          </Field>
          {error && <div className="text-meta text-danger">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-border bg-surface-subtle px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" size="sm" disabled={busy || !name.trim() || !baseURL.trim()} onClick={() => void submit()}>
            {t('settings.modelConfig.addProvider')}
          </Button>
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
