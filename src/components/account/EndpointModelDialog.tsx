import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { KeyProbeCode, MemoryEndpointApiFormat, MemoryModelRef } from '@hip/protocol'
import {
  type MemoryEndpointPurpose,
  type RerankApiFormat,
  memoryEndpointProviderId,
  resolveMemoryApiFormat,
} from '@/lib/memoryEndpoint'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { sessionService } from '@/domain/sessionService'
import { useDomainStore } from '@/domain/sessionStore'

const inputCls =
  'h-9 w-full rounded-md border border-border bg-surface px-2.5 text-body text-ink focus:outline-none focus:ring-2 focus:ring-accent/60'

export type EndpointDraft = {
  baseURL: string
  modelID: string
  apiKey: string
  apiFormat: MemoryEndpointApiFormat
}

/**
 * Independent endpoint form for embedding / rerank (base URL + API key + model id).
 * Does not use the chat provider catalog.
 *
 * - Embedding: fixed OpenAI Embeddings protocol (industry standard).
 * - Rerank: Cohere or Jina wire format (no OpenAI standard).
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
  onSave: (draft: EndpointDraft) => Promise<void>
  onClear: () => Promise<void>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const connection = useDomainStore((s) => s.connection)
  const [baseURL, setBaseURL] = useState('')
  const [modelID, setModelID] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [apiFormat, setApiFormat] = useState<MemoryEndpointApiFormat>(() =>
    resolveMemoryApiFormat(purpose, existing),
  )
  const [error, setError] = useState<string | null>(null)
  const [testRunning, setTestRunning] = useState(false)
  const [testResult, setTestResult] = useState<{
    ok: boolean
    message: string
    checkedAt: number
  } | null>(null)

  // Reuse stored key only if already on the independent virtual slot; legacy chat keys cannot transfer.
  const canReuseStoredKey = virtualKeyConfigured

  useEffect(() => {
    if (!open) return
    setBaseURL(existing?.baseURL ?? '')
    setModelID(existing?.modelID ?? '')
    setApiKey('')
    setApiFormat(resolveMemoryApiFormat(purpose, existing))
    setError(null)
    setTestRunning(false)
    setTestResult(null)
  }, [open, purpose, existing?.baseURL, existing?.modelID, existing?.providerID, existing?.apiFormat])

  function probeMessage(code: KeyProbeCode, fallback: string, cached?: boolean): string {
    if (code === 'OK') {
      return cached
        ? t('settings.modelConfig.testSuccessCached')
        : t('settings.modelConfig.testSuccess')
    }
    const byCode: Record<Exclude<KeyProbeCode, 'OK'>, string> = {
      MISSING_KEY: t('settings.modelConfig.testError.MISSING_KEY'),
      MISSING_BASE_URL: t('settings.modelConfig.testError.MISSING_BASE_URL'),
      MISSING_MODEL: t('settings.modelConfig.testError.MISSING_MODEL'),
      PROVIDER_DISABLED: t('settings.modelConfig.testError.PROVIDER_DISABLED'),
      INCOMPATIBLE_PROVIDER: t('settings.modelConfig.testError.INCOMPATIBLE_PROVIDER'),
      AUTH_FAILED: t('settings.modelConfig.testError.AUTH_FAILED'),
      MODEL_NOT_FOUND: t('settings.modelConfig.testError.MODEL_NOT_FOUND'),
      RATE_LIMITED: t('settings.modelConfig.testError.RATE_LIMITED'),
      NETWORK: t('settings.modelConfig.testError.NETWORK'),
      PROVIDER_ERROR: t('settings.modelConfig.testError.PROVIDER_ERROR'),
      PROBE_RATE_LIMITED: t('settings.modelConfig.testError.PROBE_RATE_LIMITED'),
      PROBE_BUSY: t('settings.modelConfig.testError.PROBE_BUSY'),
      PROBE_UNSUPPORTED: t('settings.modelConfig.testError.PROBE_UNSUPPORTED'),
      PROBE_DISABLED: t('settings.modelConfig.testError.PROBE_DISABLED'),
      INVALID_RESPONSE: t('settings.modelConfig.testError.INVALID_RESPONSE'),
      INTERNAL: t('settings.modelConfig.testError.INTERNAL'),
    }
    return byCode[code] || fallback || t('settings.modelConfig.error')
  }

  async function handleVerify() {
    const base = baseURL.trim()
    const model = modelID.trim()
    const draftKey = apiKey.trim()
    if (!base) {
      setTestResult({
        ok: false,
        message: t('settings.modelConfig.testNoBaseURL'),
        checkedAt: Date.now(),
      })
      return
    }
    if (!model) {
      setTestResult({
        ok: false,
        message: t('settings.modelConfig.testError.MISSING_MODEL'),
        checkedAt: Date.now(),
      })
      return
    }
    if (!draftKey && !canReuseStoredKey) {
      setTestResult({
        ok: false,
        message: t('settings.modelConfig.testNoKey'),
        checkedAt: Date.now(),
      })
      return
    }
    if (connection !== 'connected') {
      setTestResult({
        ok: false,
        message: t('settings.modelConfig.testError.NETWORK'),
        checkedAt: Date.now(),
      })
      return
    }
    setTestRunning(true)
    setTestResult(null)
    try {
      const result = await sessionService.testProvider({
        purpose,
        providerID: memoryEndpointProviderId(purpose),
        baseURL: base,
        modelID: model,
        ...(draftKey ? { apiKey: draftKey } : {}),
      })
      setTestResult({
        ok: result.ok,
        message: probeMessage(result.code, result.message, result.cached),
        checkedAt: result.checkedAt || Date.now(),
      })
    } catch (e) {
      console.error('[endpointDialog] testProvider', e)
      setTestResult({
        ok: false,
        message: t('settings.modelConfig.testError.INTERNAL'),
        checkedAt: Date.now(),
      })
    } finally {
      setTestRunning(false)
    }
  }

  const title =
    purpose === 'embedding'
      ? t('settings.modelConfig.endpointDialog.embeddingTitle')
      : t('settings.modelConfig.endpointDialog.rerankTitle')

  const canSave =
    baseURL.trim().length > 0 && modelID.trim().length > 0 && (!!apiKey.trim() || canReuseStoredKey)

  async function submit() {
    if (!canSave) return
    setError(null)
    try {
      await onSave({
        baseURL: baseURL.trim(),
        modelID: modelID.trim(),
        apiKey: apiKey.trim(),
        apiFormat: purpose === 'embedding' ? 'openai' : apiFormat,
      })
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

          {purpose === 'embedding' ? (
            <Field label={t('settings.modelConfig.endpointDialog.apiProtocol')}>
              <div
                className="rounded-md border border-border bg-surface-subtle px-2.5 py-2"
                data-testid="endpoint-embedding-protocol"
              >
                <div className="text-body font-medium text-ink">
                  {t('settings.modelConfig.apiFormat.openai')}
                </div>
                <p className="mt-0.5 text-caption text-ink-tertiary">
                  {t('settings.modelConfig.endpointDialog.embeddingProtocolHint')}
                </p>
              </div>
            </Field>
          ) : (
            <Field label={t('settings.modelConfig.endpointDialog.apiProtocol')}>
              <select
                className={cn(inputCls, 'cursor-pointer')}
                data-testid="endpoint-rerank-api-format"
                value={apiFormat === 'jina' ? 'jina' : 'cohere'}
                onChange={(e) => setApiFormat(e.target.value as RerankApiFormat)}
              >
                <option value="cohere">{t('settings.modelConfig.apiFormat.cohere')}</option>
                <option value="jina">{t('settings.modelConfig.apiFormat.jina')}</option>
              </select>
              <p className="mt-1 text-caption text-ink-tertiary">
                {t('settings.modelConfig.endpointDialog.rerankProtocolHint')}
              </p>
            </Field>
          )}

          <Field label={t('settings.modelConfig.baseUrl')}>
            <input
              className={cn(inputCls, 'font-mono')}
              data-testid={`endpoint-${purpose}-base-url`}
              value={baseURL}
              onChange={(e) => setBaseURL(e.target.value)}
              placeholder={
                purpose === 'embedding'
                  ? 'https://api.openai.com/v1'
                  : apiFormat === 'jina'
                    ? 'https://api.jina.ai/v1'
                    : 'https://api.cohere.com/v2'
              }
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
                purpose === 'embedding'
                  ? 'text-embedding-3-small'
                  : apiFormat === 'jina'
                    ? 'jina-reranker-v2-base-multilingual'
                    : 'rerank-v3.5'
              }
              autoComplete="off"
            />
          </Field>
          {error && (
            <div className="text-meta text-danger" role="alert">
              {error}
            </div>
          )}
          {testResult && (
            <div
              className={cn('text-meta', testResult.ok ? 'text-success' : 'text-danger')}
              role="status"
              data-testid={`endpoint-${purpose}-test-result`}
            >
              {testResult.message}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border bg-surface-subtle px-5 py-3">
          <div className="flex items-center gap-2">
            {existing && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy || testRunning}
                data-testid={`endpoint-${purpose}-clear`}
                onClick={() => void clear()}
              >
                {t(`settings.modelConfig.purpose.${purpose}.clear`)}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={busy || testRunning || connection !== 'connected'}
              data-testid={`endpoint-${purpose}-verify`}
              onClick={() => void handleVerify()}
            >
              {testRunning
                ? t('settings.modelConfig.testRunning')
                : t('settings.modelConfig.testEndpoint')}
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={busy || testRunning || !canSave}
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
