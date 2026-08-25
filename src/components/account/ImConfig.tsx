import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MessageSquare,
  Plus,
  Pencil,
  Trash2,
  Wifi,
  WifiOff,
  AlertTriangle,
  CheckCircle,
  Zap,
  Loader2,
} from 'lucide-react'
import type { ImConnectorPublic, ImPlatform } from '@hip/protocol'
import { useImConnectorsStore } from '@/store/imConnectorsStore'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input, inputClassName } from '@/components/ui/Input'
import { Switch } from '@/components/ui/Switch'
import { cn } from '@/lib/utils'
import {
  IM_PLATFORM_CATALOG,
  getPlatformEntry,
  connectorFormFromRecord,
  buildConnectorDraft,
  type ImPlatformEntry,
} from './imConnectorCatalog'

const inputCls = inputClassName

/** Compatible with i18next TFunction without requiring the full key union. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Translate = (k: any, p?: any) => string

/** IM Connector settings page — matches layout of HookConfig / McpConfig. */
export function ImConfig() {
  const { t: rawT } = useTranslation()
  const t = rawT as Translate
  const {
    connectors,
    loaded,
    error,
    wsConnected,
    gatewayStatuses,
    testFeedback,
    saveResult,
    load,
    upsert,
    remove,
    test,
    clearTestFeedback,
    clearSaveResult,
  } = useImConnectorsStore()

  const [editing, setEditing] = useState<ImPlatformEntry | null>(null)
  const [editConnector, setEditConnector] = useState<ImConnectorPublic | null>(null)
  const [deleting, setDeleting] = useState<ImConnectorPublic | null>(null)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const platformsWithConnector = useMemo(
    () => new Set(connectors.map((c) => c.platform)),
    [connectors],
  )
  const emptyPlatforms = useMemo(
    () => IM_PLATFORM_CATALOG.filter((p) => !platformsWithConnector.has(p.platform)),
    [platformsWithConnector],
  )

  const handleSave = async (form: Record<string, string>, platform: ImPlatform) => {
    const draft = buildConnectorDraft(form, platform)
    const result = await upsert(draft)
    if (result.ok) {
      setEditing(null)
      setEditConnector(null)
    }
    return result
  }

  const handleDelete = async () => {
    if (!deleting) return
    await remove(deleting.id)
    setDeleting(null)
  }

  return (
    <div className="p-6" data-testid="settings-im-page">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-title font-semibold text-ink">
            {t('settings.im.title')}
          </h2>
          <p className="mt-1 text-body text-ink-secondary">
            {t('settings.im.intro')}
          </p>
          <p className="mt-1 text-caption text-ink-tertiary">
            {t('settings.im.offlineNote')}
          </p>
        </div>
        {loaded && connectors.length > 0 && emptyPlatforms.length > 0 && (
          <span className="text-meta text-ink-tertiary">
            {t('settings.im.connectorCount', { count: connectors.length })}
          </span>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="mt-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-meta text-danger">
          {error}
        </div>
      )}

      {/* WS disconnected banner */}
      {!wsConnected && (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-meta text-warning">
          <WifiOff className="h-3.5 w-3.5 shrink-0" />
          {t('settings.im.wsDisconnected')}
        </div>
      )}

      {/* Save success banner */}
      {saveResult?.ok && (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-meta text-success">
          <CheckCircle className="h-3.5 w-3.5 shrink-0" />
          {t('settings.im.saveSuccess')}
          <button
            type="button"
            onClick={clearSaveResult}
            className="ml-auto text-ink-tertiary hover:text-ink"
          >
            ×
          </button>
        </div>
      )}

      {/* Test feedback banner */}
      {testFeedback && (
        <div
          className={cn(
            'mt-3 rounded-md border px-3 py-2 text-meta',
            testFeedback.ok
              ? 'border-success/40 bg-success/10 text-success'
              : 'border-danger/40 bg-danger/10 text-danger',
          )}
        >
          {testFeedback.ok ? t('settings.im.testSuccess') : (testFeedback.error ?? t('settings.im.testFailed'))}
          <button
            type="button"
            onClick={clearTestFeedback}
            className="ml-2 text-ink-tertiary hover:text-ink"
          >
            ×
          </button>
        </div>
      )}

      {/* Content — show immediately; store populates async via WS */}
      <div className="mt-5" data-testid="im-connector-list">
        {connectors.length === 0 ? (
          <EmptyState
            onAdd={(entry) => setEditing(entry)}
          />
        ) : (
          <div className="space-y-6">
            {/* Existing connectors */}
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
              {connectors.map((c) => (
                <ConnectorRow
                  key={c.id}
                  connector={c}
                  gatewayStatus={gatewayStatuses[c.id]}
                  onEdit={() => {
                    const entry = getPlatformEntry(c.platform)
                    if (entry) {
                      setEditConnector(c)
                      setEditing(entry)
                    }
                  }}
                  onDelete={() => setDeleting(c)}
                  onTest={() => void test(c.id)}
                  onToggleEnabled={(enabled) => {
                    void upsert({
                      id: c.id,
                      platform: c.platform,
                      name: c.name,
                      enabled,
                      permissionMode: c.permissionMode,
                    })
                  }}
                />
              ))}
            </ul>

            {/* Platform cards to add more */}
            {emptyPlatforms.length > 0 && (
              <div>
                <h3 className="text-meta font-medium text-ink-secondary">
                  {t('settings.im.connect')}
                </h3>
                <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {emptyPlatforms.map((entry) => (
                    <PlatformAddCard
                      key={entry.platform}
                      entry={entry}
                      onAdd={() => setEditing(entry)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add/Edit modal */}
      {editing && (
        <ConnectorEditorModal
          entry={editing}
          existing={editConnector}
          onSave={(form) => handleSave(form, editing.platform)}
          onClose={() => {
            setEditing(null)
            setEditConnector(null)
          }}
        />
      )}

      {/* Delete confirmation */}
      {deleting && (
        <Modal
          open
          variant="confirm"
          onOpenChange={(o) => {
            if (!o) setDeleting(null)
          }}
          title={t('settings.im.deleteConfirm')}
        >
          <div className="p-5">
            <p className="text-body text-ink-secondary">
              {t('settings.im.deleteConfirmBody')}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setDeleting(null)}>
                {t('settings.im.cancel')}
              </Button>
              <Button variant="danger" size="sm" onClick={() => void handleDelete()}>
                {t('settings.im.delete')}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────

function EmptyState({ onAdd }: { onAdd: (entry: ImPlatformEntry) => void }) {
  const { t: rawT } = useTranslation()
  const t = rawT as Translate

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-12 text-center">
        <MessageSquare size={32} className="text-ink-tertiary" />
        <div>
          <p className="text-body font-medium text-ink-secondary">
            {t('settings.im.noConnectors')}
          </p>
          <p className="mt-1 text-caption text-ink-tertiary">
            {t('settings.im.offlineNote')}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {IM_PLATFORM_CATALOG.map((entry) => (
          <PlatformAddCard
            key={entry.platform}
            entry={entry}
            onAdd={() => onAdd(entry)}
          />
        ))}
      </div>
    </div>
  )
}

function PlatformAddCard({
  entry,
  onAdd,
}: {
  entry: ImPlatformEntry
  onAdd: () => void
}) {
  const { t: rawT } = useTranslation()
  const t = rawT as Translate

  return (
    <div
      data-testid={`im-card-${entry.platform}`}
      className={cn(
        'relative flex min-h-[140px] flex-col rounded-lg border border-border bg-surface p-4 transition-colors hover:bg-surface-subtle',
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
          style={{ backgroundColor: entry.brandColor }}
        >
          {t(entry.nameKey)[0]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-body font-medium text-ink">
            {t(entry.nameKey)}
          </div>
          <div className="mt-1 text-meta text-ink-secondary">
            {t(entry.descKey)}
          </div>
        </div>
      </div>

      <div className="mt-3 flex-1">
        <p className="text-caption text-ink-tertiary">
          {t(entry.gateKey)}
        </p>
      </div>

      <div className="mt-4">
        <Button
          variant="primary"
          size="sm"
          className="gap-1.5"
          onClick={onAdd}
        >
          <Plus size={14} />
          {t('settings.im.connect')}
        </Button>
      </div>
    </div>
  )
}

function ConnectorRow({
  connector,
  gatewayStatus,
  onEdit,
  onDelete,
  onTest,
  onToggleEnabled,
}: {
  connector: ImConnectorPublic
  gatewayStatus?: { status: string; lastError?: string | null }
  onEdit: () => void
  onDelete: () => void
  onTest: () => void
  onToggleEnabled: (enabled: boolean) => void
}) {
  const { t: rawT } = useTranslation()
  const t = rawT as Translate
  const entry = getPlatformEntry(connector.platform)
  const effectiveStatus = gatewayStatus?.status ?? connector.status
  const statusLabel = t(`settings.im.status.${effectiveStatus}`)
  const statusTitle = gatewayStatus?.lastError
    ? `${statusLabel}: ${gatewayStatus.lastError}`
    : statusLabel

  return (
    <li
      data-testid={`im-connector-${connector.id}`}
      className={cn(
        !connector.enabled && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-3.5 px-3.5 py-3">
        <span
          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white"
          style={{ backgroundColor: entry?.brandColor ?? '#666' }}
        >
          {entry ? t(entry.nameKey)[0] : '?'}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body font-medium text-ink">
              {connector.name}
            </span>
            <ImStatusBadge status={effectiveStatus} title={statusTitle} />
            {entry && (
              <Badge>{t(entry.nameKey)}</Badge>
            )}
          </div>
          <p className="mt-0.5 text-caption text-ink-tertiary">
            {t(`settings.im.permissionMode`)}: {t(`settings.im.permissionMode${connector.permissionMode === 'auto' ? 'Auto' : 'Confirm'}`)}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <Switch
            checked={connector.enabled}
            onCheckedChange={onToggleEnabled}
            ariaLabel={t('settings.im.enable')}
          />
          <div className="flex items-center gap-1">
            <ActionButton
              icon={<Zap size={14} />}
              label={t('settings.im.testMessage')}
              onClick={onTest}
            />
            <ActionButton
              icon={<Pencil size={14} />}
              label={t('settings.im.edit')}
              onClick={onEdit}
            />
            <ActionButton
              icon={<Trash2 size={14} />}
              label={t('settings.im.delete')}
              onClick={onDelete}
              danger
            />
          </div>
        </div>
      </div>
    </li>
  )
}

function ConnectorEditorModal({
  entry,
  existing,
  onSave,
  onClose,
}: {
  entry: ImPlatformEntry
  existing: ImConnectorPublic | null
  onSave: (form: Record<string, string>) => Promise<{ ok: boolean; error?: string }>
  onClose: () => void
}) {
  const { t: rawT } = useTranslation()
  const t = rawT as Translate
  const initialForm = existing
    ? connectorFormFromRecord(existing)
    : {
        id: '',
        name: '',
        platform: entry.platform,
        permissionMode: 'confirm',
        ...Object.fromEntries(entry.credentialsFields.map((f) => [f.key, ''])),
      }
  const [form, setForm] = useState<Record<string, string>>(initialForm)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const patch = (key: string, value: string) =>
    setForm((f) => ({ ...f, [key]: value }))

  const canSave = form.name.trim().length > 0 && !busy

  const handleSave = async () => {
    if (!canSave) return
    setBusy(true)
    setError(null)
    try {
      const result = await onSave(form)
      if (!result.ok) {
        setError(result.error ?? t('settings.im.saveFailed'))
        setBusy(false)
      }
      // On success, parent closes the modal
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  const title = existing ? t('settings.im.edit') : t('settings.im.connect')

  return (
    <Modal
      open
      variant="confirm"
      closeDisabled={busy}
      onOpenChange={(o) => {
        if (!o && !busy) onClose()
      }}
      title={`${title} — ${t(entry.nameKey)}`}
    >
      <div className="space-y-4 p-5">
        {/* Name */}
        <div>
          <label className="mb-1 block text-meta font-medium text-ink-secondary">
            {t('settings.im.field.name')}
          </label>
          <Input
            value={form.name}
            onChange={(e) => patch('name', e.target.value)}
            placeholder={t('settings.im.field.namePlaceholder')}
            disabled={busy}
          />
        </div>

        {/* Credential fields */}
        {entry.credentialsFields.map((field) => (
          <div key={field.key}>
            <label className="mb-1 block text-meta font-medium text-ink-secondary">
              {t(field.labelKey)}
            </label>
            <Input
              type={field.type}
              value={form[field.key] ?? ''}
              onChange={(e) => patch(field.key, e.target.value)}
              placeholder={existing?.hasCredentials ? '••••••••' : ''}
              disabled={busy}
            />
          </div>
        ))}

        {/* Permission mode */}
        <div>
          <label className="mb-1 block text-meta font-medium text-ink-secondary">
            {t('settings.im.permissionMode')}
          </label>
          <select
            value={form.permissionMode}
            onChange={(e) => patch('permissionMode', e.target.value)}
            className={cn(inputCls, 'h-9')}
            disabled={busy}
          >
            <option value="confirm">{t('settings.im.permissionModeConfirm')}</option>
            <option value="auto">{t('settings.im.permissionModeAuto')}</option>
          </select>
          {form.permissionMode === 'auto' && (
            <p className="mt-1 text-caption text-ink-tertiary">
              {t('settings.im.permissionModeAutoWarning')}
            </p>
          )}
        </div>

        {/* Busy indicator */}
        {busy && (
          <div className="flex items-center gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-meta text-accent">
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
            {t('settings.im.saving')}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-meta text-danger">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            {t('settings.im.cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!canSave}
            onClick={() => void handleSave()}
          >
            {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {t('settings.im.save')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/** Status badge for connector status. */
export function ImStatusBadge({
  status,
  title,
}: {
  status: string
  title?: string
}) {
  const { t: rawT } = useTranslation()
  const t = rawT as Translate
  const config = {
    connected: { icon: CheckCircle, color: 'text-success' },
    connecting: { icon: Wifi, color: 'text-warning' },
    disconnected: { icon: WifiOff, color: 'text-ink-tertiary' },
    error: { icon: AlertTriangle, color: 'text-danger' },
  }[status] ?? { icon: WifiOff, color: 'text-ink-tertiary' }

  const Icon = config.icon

  return (
    <Badge
      className={cn('gap-1', config.color)}
      title={title}
    >
      <Icon className="w-3 h-3" />
      {t(`settings.im.status.${status}`)}
    </Badge>
  )
}

/** Icon button for card-level actions. */
function ActionButton({
  icon,
  label,
  onClick,
  danger,
  disabled,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
        danger
          ? 'text-ink-secondary hover:bg-danger/10 hover:text-danger'
          : 'text-ink-secondary hover:bg-state-hover hover:text-ink',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
      aria-label={label}
    >
      {icon}
    </button>
  )
}
