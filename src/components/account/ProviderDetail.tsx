import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, Check, Eye, EyeOff } from 'lucide-react'
import type { KeyProbeCode, ProviderApiKind } from '@hip/protocol'
import type { CatalogProvider, CatalogModel } from '@/ipc/catalog'
import { filterModels, NO_CAPS, type ModelCaps } from '@/lib/modelFilter'
import { modelBadges, type ModelCapKey } from '@/lib/modelBadges'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Switch } from '@/components/ui/Switch'
import { inputClassName } from '@/components/ui/Input'
import { ProviderLogo } from '@/components/ui/ProviderLogo'
import { cn } from '@/lib/utils'
import { sessionService } from '@/domain/sessionService'
import { useDomainStore } from '@/domain/sessionStore'

type KeyProbeStatus =
  | { state: 'idle' }
  | { state: 'running' }
  | {
      state: 'done'
      ok: boolean
      code: KeyProbeCode
      message: string
      cached?: boolean
      checkedAt: number
    }



/** The capability toggles shown above the model list; each maps to a ModelCaps key + an i18n label. */
const CAP_FILTERS = [
  { key: 'reasoning', i18n: 'reasoning' },
  { key: 'tool_call', i18n: 'tools' },
  { key: 'attachment', i18n: 'vision' },
] as const

const CAP_I18N = {
  reasoning: 'settings.modelConfig.reasoning',
  tool_call: 'settings.modelConfig.tools',
  attachment: 'settings.modelConfig.vision',
} as const satisfies Record<ModelCapKey, string>

const inputCls = cn(inputClassName, 'flex-1')

/** Right detail pane: provider connection settings and model selection. */
export function ProviderDetail({
  provider,
  configured,
  enabled,
  baseURL,
  apiKind,
  isActive,
  onSaveKey,
  onClearKey,
  onSaveBaseURL,
  onSetEnabled,
  onSetApiKind,
  onSetCurrent,
  setCurrentLabel,
  currentLabel,
  roleActions,
}: {
  provider: CatalogProvider
  configured: boolean
  enabled: boolean
  baseURL: string
  /** User/config wire protocol; shown for custom providers. */
  apiKind?: ProviderApiKind
  isActive: (modelID: string) => boolean
  onSaveKey: (value: string) => Promise<void>
  onClearKey: () => Promise<void>
  onSaveBaseURL: (value: string) => Promise<void>
  onSetEnabled: (value: boolean) => Promise<void>
  onSetApiKind?: (value: ProviderApiKind) => Promise<void>
  onSetCurrent: (modelID: string) => Promise<void>
  /** Button label when a model is not current (e.g. "Set as current"). */
  setCurrentLabel?: string
  /** Button label when a model is current (e.g. "Current"). */
  currentLabel?: string
  /** Optional role-specific actions rendered above the model list (Clear/Recommend). */
  roleActions?: ReactNode
}) {
  const { t } = useTranslation()
  const connection = useDomainStore((s) => s.connection)
  const [value, setValue] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [baseURLValue, setBaseURLValue] = useState(baseURL)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modelQuery, setModelQuery] = useState('')
  const [caps, setCaps] = useState<ModelCaps>(NO_CAPS)
  const [testStatus, setTestStatus] = useState<KeyProbeStatus>({ state: 'idle' })

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

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      setValue('')
    } catch (e) {
      console.error('[modelConfig]', e)
      setError(t('settings.modelConfig.error'))
    } finally {
      setBusy(false)
    }
  }

  // Separate from run(): saving the base URL must NOT clear the API-key draft (`value`).
  async function saveBaseURL() {
    setBusy(true)
    setError(null)
    try {
      await onSaveBaseURL(baseURLValue.trim())
    } catch (e) {
      console.error('[modelConfig]', e)
      setError(t('settings.modelConfig.error'))
    } finally {
      setBusy(false)
    }
  }

  // Toggling provider enablement must also preserve the API-key draft.
  async function setProviderEnabled(next: boolean) {
    setBusy(true)
    setError(null)
    try {
      await onSetEnabled(next)
    } catch (e) {
      console.error('[modelConfig]', e)
      setError(t('settings.modelConfig.error'))
    } finally {
      setBusy(false)
    }
  }

  async function handleTest() {
    // Local fast-path: disabled providers must not probe (product rule).
    if (!enabled) {
      setTestStatus({
        state: 'done',
        ok: false,
        code: 'PROVIDER_DISABLED',
        message: t('settings.modelConfig.testDisabled'),
        checkedAt: Date.now(),
      })
      return
    }
    const draftKey = value.trim()
    if (!configured && !draftKey) {
      setTestStatus({
        state: 'done',
        ok: false,
        code: 'MISSING_KEY',
        message: t('settings.modelConfig.testNoKey'),
        checkedAt: Date.now(),
      })
      return
    }
    const base = baseURLValue.trim()
    if (!base && provider.id !== 'anthropic') {
      setTestStatus({
        state: 'done',
        ok: false,
        code: 'MISSING_BASE_URL',
        message: t('settings.modelConfig.testNoBaseURL'),
        checkedAt: Date.now(),
      })
      return
    }
    if (connection !== 'connected') {
      setTestStatus({
        state: 'done',
        ok: false,
        code: 'NETWORK',
        message: t('settings.modelConfig.testError.NETWORK'),
        checkedAt: Date.now(),
      })
      return
    }

    setError(null)
    setTestStatus({ state: 'running' })
    try {
      const activeModel = Object.values(provider.models).find((m) => isActive(m.id))
      const result = await sessionService.testProvider({
        purpose: 'chat',
        providerID: provider.id,
        baseURL: base,
        ...(activeModel ? { modelID: activeModel.id } : {}),
        ...(draftKey ? { apiKey: draftKey } : {}),
      })
      setTestStatus({
        state: 'done',
        ok: result.ok,
        code: result.code,
        message: probeMessage(result.code, result.message, result.cached),
        cached: result.cached,
        checkedAt: result.checkedAt || Date.now(),
      })
    } catch (e) {
      console.error('[modelConfig] testProvider', e)
      setTestStatus({
        state: 'done',
        ok: false,
        code: 'INTERNAL',
        message: t('settings.modelConfig.testError.INTERNAL'),
        checkedAt: Date.now(),
      })
    }
  }

  const testRunning = testStatus.state === 'running'
  const lastProbeFailed = testStatus.state === 'done' && !testStatus.ok

  let checkedWhen = ''
  if (testStatus.state === 'done') {
    const sec = Math.max(0, Math.floor((Date.now() - testStatus.checkedAt) / 1000))
    if (sec < 45) checkedWhen = t('settings.modelConfig.testCheckedJustNow')
    else {
      const min = Math.floor(sec / 60)
      checkedWhen =
        min < 60
          ? t('settings.modelConfig.testCheckedMinutesAgo', { count: min })
          : t('settings.modelConfig.testCheckedHoursAgo', { count: Math.floor(min / 60) })
    }
  }

  const allModels = Object.values(provider.models)
  const current = allModels.find((m) => isActive(m.id))
  const rest = current ? allModels.filter((m) => m.id !== current.id) : allModels
  const filtered = filterModels(rest, modelQuery, caps)

  const status = enabled
    ? configured
      ? { key: 'ready', cls: 'bg-success/10 text-success', text: t('settings.modelConfig.ready') }
      : { key: 'missing', cls: 'bg-warning/10 text-warning', text: t('settings.modelConfig.keyMissing') }
    : { key: 'disabled', cls: 'bg-surface-muted text-ink-tertiary', text: t('settings.modelConfig.disabled') }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto">
      <section className="rounded-lg border border-border bg-surface p-4">
        <div className="mb-3 flex items-center gap-3">
          <ProviderLogo
            providerId={provider.id}
            name={provider.name}
            custom={provider.custom}
            size={32}
            className="bg-surface-muted text-ink-secondary text-body font-medium"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-body font-medium text-ink">{provider.name}</div>
            <div className="text-caption text-ink-tertiary">{provider.id}</div>
          </div>
          <span className={cn('shrink-0 rounded-md px-2 py-1 text-caption', status.cls)}>{status.text}</span>
          <Switch
            checked={enabled}
            onCheckedChange={(v) => void setProviderEnabled(v)}
            ariaLabel={t('settings.modelConfig.enabled')}
          />
        </div>

        <div className="space-y-3">
          <div>
            <div className="mb-1.5 flex items-center text-body font-medium text-ink">
              {t('settings.modelConfig.apiKey')}
              {configured && (
                <span className="ml-auto flex items-center gap-1 text-caption font-normal text-success">
                  <Check size={12} /> {t('settings.modelConfig.keyStored')}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="relative flex flex-1 items-center">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="sk-..."
                  className={cn(inputCls, 'pr-8')}
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute right-2 rounded p-0.5 text-ink-tertiary hover:bg-state-hover hover:text-ink-secondary"
                  aria-label={showKey ? t('settings.modelConfig.hide') : t('settings.modelConfig.show')}
                >
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <Button size="sm" disabled={busy || !value.trim()} onClick={() => run(() => onSaveKey(value.trim()))}>
                {configured ? t('settings.modelConfig.change') : t('settings.modelConfig.save')}
              </Button>
              <Button variant="outline" size="sm" disabled={busy || !configured} onClick={() => run(onClearKey)}>
                {t('settings.modelConfig.clear')}
              </Button>
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-body font-medium text-ink">{t('settings.modelConfig.baseUrl')}</div>
            <div className="flex items-center gap-2">
              <input
                value={baseURLValue}
                onChange={(e) => setBaseURLValue(e.target.value)}
                placeholder={provider.api ?? 'https://...'}
                className={cn(inputCls, 'font-mono text-meta')}
              />
              <Button
                size="sm"
                disabled={busy || !baseURLValue.trim() || baseURLValue.trim() === baseURL}
                onClick={() => void saveBaseURL()}
              >
                {t('settings.modelConfig.save')}
              </Button>
            </div>
          </div>

          {provider.custom && onSetApiKind && (
            <div>
              <div className="mb-1.5 text-body font-medium text-ink">{t('settings.modelConfig.apiKind')}</div>
              <select
                className={cn(inputCls, 'cursor-pointer')}
                value={apiKind ?? 'openai'}
                disabled={busy}
                data-testid="provider-api-kind"
                onChange={(e) => {
                  const v = e.target.value as ProviderApiKind
                  void run(() => onSetApiKind(v))
                }}
              >
                <option value="openai">{t('settings.modelConfig.apiKindOpenAI')}</option>
                <option value="anthropic">{t('settings.modelConfig.apiKindAnthropic')}</option>
              </select>
              <p className="mt-1 text-caption text-ink-tertiary">{t('settings.modelConfig.apiKindHint')}</p>
            </div>
          )}

          <div className="flex flex-col gap-1.5 pt-1">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                data-testid="provider-verify-config"
                disabled={!enabled || testRunning || connection !== 'connected'}
                onClick={() => void handleTest()}
              >
                {testRunning ? t('settings.modelConfig.testRunning') : t('settings.modelConfig.test')}
              </Button>
              {testStatus.state === 'done' && (
                <span
                  data-testid="provider-verify-result"
                  className={cn(
                    'text-caption',
                    testStatus.ok ? 'text-success' : 'text-danger',
                  )}
                >
                  {testStatus.message}
                </span>
              )}
            </div>
            {testStatus.state === 'done' && checkedWhen && (
              <div
                className="text-caption text-ink-tertiary"
                data-testid="provider-verify-checked-at"
              >
                {t('settings.modelConfig.testCheckedCaption', { when: checkedWhen })}
              </div>
            )}
            {lastProbeFailed && (
              <div className="text-caption text-warning" role="status" data-testid="provider-verify-fail-hint">
                {t('settings.modelConfig.testProbeFailedHint')}
              </div>
            )}
          </div>

          {error && <div className="text-meta text-danger">{error}</div>}
        </div>
      </section>

      <section className={cn('flex min-h-0 flex-1 flex-col rounded-lg border border-border bg-surface p-4', !enabled && 'opacity-75')}>
        <div className="mb-3 flex items-center text-body font-medium text-ink">
          {t('settings.modelConfig.models')}
          {allModels.length > 0 && (
            <span className="ml-auto text-caption font-normal text-ink-tertiary">
              {allModels.length} {t('settings.modelConfig.modelsUnit')}
            </span>
          )}
        </div>

        <div className="mb-3 flex items-center gap-2">
          <div className="flex h-9 flex-1 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5">
            <Search size={14} className="shrink-0 text-ink-tertiary" />
            <input
              value={modelQuery}
              onChange={(e) => setModelQuery(e.target.value)}
              placeholder={t('settings.modelConfig.searchModels')}
              className="w-full bg-transparent text-body text-ink placeholder:text-ink-tertiary focus:outline-none"
            />
          </div>
          {CAP_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setCaps((c) => ({ ...c, [f.key]: !c[f.key] }))}
              className={cn(
                'h-9 shrink-0 rounded-md px-2.5 text-caption transition-colors',
                caps[f.key]
                  ? 'border border-ink bg-surface text-ink font-medium shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
                  : 'border border-border text-ink-secondary hover:bg-state-hover',
              )}
            >
              {t(`settings.modelConfig.${f.i18n}`)}
            </button>
          ))}
        </div>

        {!enabled && (
          <div className="mb-3 rounded-md bg-surface-muted px-3 py-2 text-caption text-ink-tertiary">
            {t('settings.modelConfig.disabledHint')}
          </div>
        )}

        {roleActions && <div className="mb-3">{roleActions}</div>}

        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {current && (
            <ModelCard
              model={current}
              isCurrent
              disabled={busy || !enabled}
              setCurrentLabel={setCurrentLabel}
              currentLabel={currentLabel}
              onClick={() => void run(() => onSetCurrent(current.id))}
            />
          )}

          <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
            {filtered.length > 0 ? (
              filtered.map((m) => (
                <ModelCard
                  key={m.id}
                  model={m}
                  isCurrent={false}
                  disabled={busy || !enabled}
                  setCurrentLabel={setCurrentLabel}
                  currentLabel={currentLabel}
                  onClick={() => void run(() => onSetCurrent(m.id))}
                />
              ))
            ) : (
              <div className="col-span-full px-2.5 py-4 text-center text-meta text-ink-tertiary">
                {t('settings.modelConfig.noMatches')}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}

function ModelCard({
  model,
  isCurrent,
  disabled,
  setCurrentLabel,
  currentLabel,
  onClick,
}: {
  model: CatalogModel
  isCurrent: boolean
  disabled: boolean
  setCurrentLabel?: string
  currentLabel?: string
  onClick: () => void
}) {
  const { t } = useTranslation()
  const { contextK, caps } = modelBadges(model)
  const meta = [contextK !== null ? `${contextK}K` : null, ...caps.map((c) => t(CAP_I18N[c]))].filter(Boolean)
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex items-center gap-2.5 rounded-md border px-3 py-2.5 text-left transition-colors disabled:opacity-60',
        isCurrent ? 'border-accent bg-accent-active' : 'border-border hover:bg-state-hover',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className={cn('truncate text-body', isCurrent && 'font-medium text-accent-strong')}>{model.name}</div>
        {meta.length > 0 && (
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {meta.map((m) => (
              <Badge key={m}>{m}</Badge>
            ))}
          </div>
        )}
      </div>
      <span className="shrink-0 text-caption text-accent-strong">
        {isCurrent
          ? (currentLabel ?? t('settings.modelConfig.current'))
          : (setCurrentLabel ?? t('settings.modelConfig.setCurrent'))}
      </span>
    </button>
  )
}
