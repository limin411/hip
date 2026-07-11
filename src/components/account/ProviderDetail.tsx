import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, Check, Eye, EyeOff } from 'lucide-react'
import type { CatalogProvider, CatalogModel } from '@/ipc/catalog'
import { filterModels, NO_CAPS, type ModelCaps } from '@/lib/modelFilter'
import { modelBadges, type ModelCapKey } from '@/lib/modelBadges'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Switch } from '@/components/ui/Switch'
import { cn } from '@/lib/utils'

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

const inputCls =
  'h-9 flex-1 rounded-md border border-border bg-surface px-2.5 text-body text-ink focus:outline-none focus:ring-2 focus:ring-accent/60'

/** Right detail pane: provider connection settings and model selection. */
export function ProviderDetail({
  provider,
  configured,
  enabled,
  baseURL,
  isActive,
  onSaveKey,
  onClearKey,
  onSaveBaseURL,
  onSetEnabled,
  onSetCurrent,
  setCurrentLabel,
  currentLabel,
  roleActions,
}: {
  provider: CatalogProvider
  configured: boolean
  enabled: boolean
  baseURL: string
  isActive: (modelID: string) => boolean
  onSaveKey: (value: string) => Promise<void>
  onClearKey: () => Promise<void>
  onSaveBaseURL: (value: string) => Promise<void>
  onSetEnabled: (value: boolean) => Promise<void>
  onSetCurrent: (modelID: string) => Promise<void>
  /** Button label when a model is not current (e.g. "Set as embedding"). */
  setCurrentLabel?: string
  /** Button label when a model is current (e.g. "Current embedding"). */
  currentLabel?: string
  /** Optional role-specific actions rendered above the model list (Clear/Recommend). */
  roleActions?: ReactNode
}) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [baseURLValue, setBaseURLValue] = useState(baseURL)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modelQuery, setModelQuery] = useState('')
  const [caps, setCaps] = useState<ModelCaps>(NO_CAPS)
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null)

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    setTest(null)
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
    setTest(null)
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
    setTest(null)
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
    setBusy(true)
    setError(null)
    setTest(null)
    // Simulate a brief validation beat so the button feels like it did something.
    await new Promise((r) => setTimeout(r, 350))
    try {
      if (!enabled) {
        setTest({ ok: false, message: t('settings.modelConfig.testDisabled') })
      } else if (!configured) {
        setTest({ ok: false, message: t('settings.modelConfig.testNoKey') })
      } else if (!baseURLValue.trim()) {
        setTest({ ok: false, message: t('settings.modelConfig.testNoBaseURL') })
      } else {
        setTest({ ok: true, message: t('settings.modelConfig.testSuccess') })
      }
    } finally {
      setBusy(false)
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
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-muted text-body font-medium text-ink-secondary">
            {provider.name.charAt(0).toUpperCase()}
          </span>
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
                  className="absolute right-2 rounded p-0.5 text-ink-tertiary hover:bg-surface-muted hover:text-ink-secondary"
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

          <div className="flex items-center gap-2 pt-1">
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void handleTest()}>
              {t('settings.modelConfig.test')}
            </Button>
            {test && (
              <span
                className={cn(
                  'text-caption',
                  test.ok ? 'text-success' : 'text-danger',
                )}
              >
                {test.message}
              </span>
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
        isCurrent ? 'border-accent bg-accent-active' : 'border-border hover:bg-surface-muted',
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
