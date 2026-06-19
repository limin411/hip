import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plug, Plus, Pencil, Trash2, MoreVertical, Check, X, RefreshCw } from 'lucide-react'
import type { McpServerConfig } from '@hip/protocol'
import { useMcpServersStore } from '@/store/mcpServersStore'
import { useMcpStatuses, type McpServerStatusVM } from '@/domain'
import { cn } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import { Badge } from '@/components/ui/Badge'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/DropdownMenu'
import {
  buildMcpDraft,
  isMcpDraftValid,
  mcpConfigToForm,
  EMPTY_MCP_FORM,
  type McpForm,
  type KvPair,
} from '@/lib/mcpServerDraft'

const inputCls =
  'h-9 w-full rounded-md border border-border bg-surface px-2.5 text-body text-ink focus:outline-none focus:ring-2 focus:ring-accent/60'

type Editing = { mode: 'add' } | { mode: 'edit'; server: McpServerConfig } | null

/** Pure helper: map status to status indicator emoji. */
export function statusEmoji(status: McpServerStatusVM['status']): string {
  switch (status) {
    case 'connected': return '\uD83D\uDFE2'
    case 'connecting': return '\uD83D\uDFE1'
    case 'disconnected': return '\uD83D\uDD34'
    case 'error': return '\u26A0\uFE0F'
  }
}

/** Pure helper: map status to a human-readable label key. */
export function statusLabelKey(status: McpServerStatusVM['status']): string {
  switch (status) {
    case 'connected': return 'settings.mcp.statusConnected'
    case 'connecting': return 'settings.mcp.statusConnecting'
    case 'disconnected': return 'settings.mcp.statusDisconnected'
    case 'error': return 'settings.mcp.statusError'
  }
}

/** Pure helper: determine which tools are enabled based on enabledTools/disabledTools lists. */
export function resolveToolEnabled(
  toolName: string,
  enabledTools: string[],
  disabledTools: string[],
): boolean {
  if (disabledTools.includes(toolName)) return false
  if (enabledTools.length === 0) return true
  return enabledTools.includes(toolName)
}

/** Pure helper: build new enabledTools/disabledTools from toggle action. */
export function toggleTool(
  toolName: string,
  enabledTools: string[],
  disabledTools: string[],
): { enabledTools: string[]; disabledTools: string[] } {
  const isEnabled = resolveToolEnabled(toolName, enabledTools, disabledTools)
  if (isEnabled) {
    // Disable it: add to disabledTools if allowlist is empty, else remove from enabledTools
    if (enabledTools.length === 0) {
      return { enabledTools, disabledTools: [...disabledTools, toolName] }
    }
    return { enabledTools: enabledTools.filter((t) => t !== toolName), disabledTools }
  }
  // Enable it: add to enabledTools if allowlist has items, else remove from disabledTools
  if (enabledTools.length > 0) {
    return { enabledTools: [...enabledTools, toolName], disabledTools }
  }
  return { enabledTools, disabledTools: disabledTools.filter((t) => t !== toolName) }
}

export function McpConfig() {
  const { t } = useTranslation()
  const { servers, loaded, load, addServer, updateServer, removeServer } = useMcpServersStore()
  const mcpStatuses = useMcpStatuses()
  const [editing, setEditing] = useState<Editing>(null)
  const [deleting, setDeleting] = useState<McpServerConfig | null>(null)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const statusByServer = new Map(mcpStatuses.map((s) => [s.id, s]))

  return (
    <div className="p-6">
      <h2 className="text-title font-semibold text-ink">{t('settings.mcp.title')}</h2>
      <p className="mt-1 text-body text-ink-secondary">{t('settings.mcp.intro')}</p>

      <div className="mt-5 space-y-2">
        {servers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-5 text-center text-meta text-ink-tertiary">
            {t('settings.mcp.empty')}
          </div>
        ) : (
          servers.map((s) => (
            <McpServerRow
              key={s.id}
              server={s}
              status={statusByServer.get(s.id)}
              onToggle={(enabled) => void updateServer(s.id, { enabled })}
              onEdit={() => setEditing({ mode: 'edit', server: s })}
              onDelete={() => setDeleting(s)}
            />
          ))
        )}
        <button
          onClick={() => setEditing({ mode: 'add' })}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-3 text-body font-medium text-accent-strong transition-colors hover:bg-accent-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <Plus size={15} /> {t('settings.mcp.add')}
        </button>
      </div>

      {editing && (
        <McpServerEditor
          initial={editing.mode === 'edit' ? editing.server : null}
          status={editing.mode === 'edit' ? statusByServer.get(editing.server.id) : undefined}
          onCancel={() => setEditing(null)}
          onSave={async (draft) => {
            if (editing.mode === 'edit') await updateServer(editing.server.id, draft)
            else await addServer(draft)
            setEditing(null)
          }}
        />
      )}

      {deleting && (
        <DeleteServerDialog
          server={deleting}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            void removeServer(deleting.id)
            setDeleting(null)
          }}
        />
      )}
    </div>
  )
}

function McpServerRow({
  server,
  status,
  onToggle,
  onEdit,
  onDelete,
}: {
  server: McpServerConfig
  status?: McpServerStatusVM
  onToggle: (enabled: boolean) => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const transportLabel =
    server.transport === 'stdio'
      ? t('settings.mcp.transportStdio')
      : server.transport === 'sse'
        ? t('settings.mcp.transportSse')
        : t('settings.mcp.transportHttp')
  const detail =
    server.transport === 'stdio' ? [server.command, ...(server.args ?? [])].join(' ') : (server.url ?? '')
  const statusEmojiStr = status ? statusEmoji(status.status) : null
  const statusLabel = status
    ? status.status === 'connected' ? t('settings.mcp.statusConnected')
    : status.status === 'connecting' ? t('settings.mcp.statusConnecting')
    : status.status === 'disconnected' ? t('settings.mcp.statusDisconnected')
    : t('settings.mcp.statusError')
    : null
  const toolCount = status?.toolCount

  return (
    <div className="flex items-center gap-3.5 rounded-lg border border-border bg-surface px-4 py-3.5">
      <span
        className={cn(
          'flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg bg-accent-subtle text-accent-strong',
          !server.enabled && 'opacity-60',
        )}
      >
        <Plug size={18} />
      </span>
      <div className={cn('min-w-0 flex-1', !server.enabled && 'opacity-60')}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-body font-medium text-ink">{server.name}</span>
          <Badge>{transportLabel}</Badge>
          {statusEmojiStr && statusLabel && (
            <span
              className="text-caption"
              title={status?.lastError ? `${String(statusLabel)}: ${status.lastError}` : String(statusLabel)}
            >
              {statusEmojiStr} {statusLabel}
            </span>
          )}
          {toolCount !== undefined && (
            <span className="text-caption text-ink-tertiary">
              {toolCount} tool{toolCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="mt-1 truncate font-mono text-caption text-ink-tertiary">{detail}</div>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        {status?.status === 'disconnected' && server.enabled && (
          <button
            onClick={() => onToggle(true)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            title={t('settings.mcp.reconnect')}
          >
            <RefreshCw size={14} />
          </button>
        )}
        <Switch checked={server.enabled} onCheckedChange={onToggle} ariaLabel={t('settings.mcp.enableThis')} />
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              aria-label={t('settings.mcp.menuMore')}
            >
              <MoreVertical size={16} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil size={14} /> {t('settings.mcp.edit')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-danger focus:bg-danger/10" onSelect={onDelete}>
              <Trash2 size={14} /> {t('settings.mcp.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

function McpServerEditor({
  initial,
  status,
  onSave,
  onCancel,
}: {
  initial: McpServerConfig | null
  status?: McpServerStatusVM
  onSave: (draft: Omit<McpServerConfig, 'id'>) => Promise<void>
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [form, setForm] = useState<McpForm>(initial ? mcpConfigToForm(initial) : EMPTY_MCP_FORM)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const patch = (p: Partial<McpForm>) => setForm((f) => ({ ...f, ...p }))
  const isStdio = form.transport === 'stdio'

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await onSave(buildMcpDraft(form))
    } catch {
      setError(t('settings.mcp.error'))
    } finally {
      setBusy(false)
    }
  }

  const discoveredTools = status?.toolNames ?? []
  const hasDiscoveredTools = discoveredTools.length > 0

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onCancel()
      }}
      title={initial ? t('settings.mcp.editTitle') : t('settings.mcp.addTitle')}
    >
      <div className="flex flex-col">
        <div className="space-y-5 p-5 max-h-[60vh] overflow-y-auto">
          <Field label={t('settings.mcp.name')}>
            <input className={inputCls} value={form.name} onChange={(e) => patch({ name: e.target.value })} placeholder={t('settings.mcp.namePlaceholder')} />
          </Field>

          <Section label={t('settings.mcp.sectionTransport')}>
            <div role="radiogroup" aria-label={t('settings.mcp.sectionTransport')} className="flex gap-2">
              <ChoiceCard selected={form.transport === 'stdio'} title={t('settings.mcp.transportStdio')} desc={t('settings.mcp.transportStdioDesc')} onClick={() => patch({ transport: 'stdio' })} />
              <ChoiceCard selected={form.transport === 'sse'} title={t('settings.mcp.transportSse')} desc={t('settings.mcp.transportSseDesc')} onClick={() => patch({ transport: 'sse' })} />
              <ChoiceCard selected={form.transport === 'http'} title={t('settings.mcp.transportHttp')} desc={t('settings.mcp.transportHttpDesc')} onClick={() => patch({ transport: 'http' })} />
            </div>
          </Section>

          {isStdio ? (
            <Section label={t('settings.mcp.sectionCommand')}>
              <Field label={t('settings.mcp.command')}>
                <input className={cn(inputCls, 'font-mono')} value={form.command} onChange={(e) => patch({ command: e.target.value })} placeholder={t('settings.mcp.commandPlaceholder')} />
              </Field>
              <Field label={t('settings.mcp.args')}>
                <input className={cn(inputCls, 'font-mono')} value={form.args} onChange={(e) => patch({ args: e.target.value })} placeholder={t('settings.mcp.argsPlaceholder')} />
              </Field>
              <Field label={t('settings.mcp.env')}>
                <KvEditor pairs={form.env} onChange={(env) => patch({ env })} />
              </Field>
            </Section>
          ) : (
            <Section label={t('settings.mcp.sectionConnection')}>
              <Field label={t('settings.mcp.url')}>
                <input className={cn(inputCls, 'font-mono')} value={form.url} onChange={(e) => patch({ url: e.target.value })} placeholder={t('settings.mcp.urlPlaceholder')} />
              </Field>
              <Field label={t('settings.mcp.headers')}>
                <KvEditor pairs={form.headers} onChange={(headers) => patch({ headers })} />
              </Field>
              <div className="text-caption text-ink-tertiary">{t('settings.mcp.remoteNote')}</div>
            </Section>
          )}

          {initial && (
            <Section label={t('settings.mcp.sectionTools')}>
              <p className="text-caption text-ink-tertiary">{t('settings.mcp.toolToggleDesc')}</p>
              {hasDiscoveredTools ? (
                <>
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (form.enabledTools.length > 0 || form.disabledTools.length > 0) {
                          patch({ enabledTools: [], disabledTools: [] })
                        }
                      }}
                      className="text-caption text-accent hover:underline"
                    >
                      {t('settings.mcp.toolToggleAll')}
                    </button>
                  </div>
                  <div className="space-y-1 mt-1 max-h-40 overflow-y-auto">
                    {discoveredTools.map((toolName) => {
                      const enabled = resolveToolEnabled(toolName, form.enabledTools, form.disabledTools)
                      return (
                        <label
                          key={toolName}
                          className="flex items-center gap-2 py-1 px-1 rounded hover:bg-surface-muted cursor-pointer"
                        >
                          <Switch
                            checked={enabled}
                            onCheckedChange={() => {
                              const result = toggleTool(toolName, form.enabledTools, form.disabledTools)
                              patch(result)
                            }}
                            ariaLabel={toolName}
                          />
                          <span className="text-body font-mono text-ink-secondary">{toolName}</span>
                        </label>
                      )
                    })}
                  </div>
                </>
              ) : (
                <div className="text-caption text-ink-tertiary mt-1">{t('settings.mcp.noToolsDiscovered')}</div>
              )}
            </Section>
          )}

          {error && <div className="text-meta text-danger">{error}</div>}
        </div>

        <div className="flex items-center gap-2 border-t border-border bg-surface-subtle px-5 py-3">
          <div className="flex flex-1 items-center gap-2">
            <Switch checked={form.enabled} onCheckedChange={(v) => patch({ enabled: v })} ariaLabel={t('settings.mcp.enableThis')} />
            <span className="text-body text-ink-secondary">{t('settings.mcp.enableThis')}</span>
          </div>
          <Button variant="outline" size="sm" onClick={onCancel}>
            {t('settings.mcp.cancel')}
          </Button>
          <Button variant="primary" size="sm" disabled={busy || !isMcpDraftValid(form)} onClick={() => void submit()}>
            {t('settings.mcp.save')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function DeleteServerDialog({
  server,
  onConfirm,
  onCancel,
}: {
  server: McpServerConfig
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onCancel()
      }}
      title={t('settings.mcp.deleteConfirmTitle', { name: server.name })}
      className="max-w-sm"
    >
      <div className="p-5">
        <p className="text-body text-ink-secondary">{t('settings.mcp.deleteConfirmBody')}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            {t('settings.mcp.cancel')}
          </Button>
          <Button variant="danger" size="sm" onClick={onConfirm}>
            {t('settings.mcp.delete')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function KvEditor({ pairs, onChange }: { pairs: KvPair[]; onChange: (pairs: KvPair[]) => void }) {
  const { t } = useTranslation()
  const setAt = (i: number, p: Partial<KvPair>) => onChange(pairs.map((kv, idx) => (idx === i ? { ...kv, ...p } : kv)))
  const removeAt = (i: number) => onChange(pairs.filter((_, idx) => idx !== i))
  const add = () => onChange([...pairs, { key: '', value: '' }])
  return (
    <div className="space-y-2">
      {pairs.map((kv, i) => (
        <div key={i} className="flex items-center gap-2">
          <input className={cn(inputCls, 'font-mono')} value={kv.key} onChange={(e) => setAt(i, { key: e.target.value })} placeholder={t('settings.mcp.keyPlaceholder')} />
          <input className={cn(inputCls, 'font-mono')} value={kv.value} onChange={(e) => setAt(i, { value: e.target.value })} placeholder={t('settings.mcp.valuePlaceholder')} />
          <button
            type="button"
            onClick={() => removeAt(i)}
            aria-label={t('settings.mcp.removePair')}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <X size={15} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-meta font-medium text-accent-strong transition-colors hover:bg-accent-subtle"
      >
        <Plus size={13} /> {t('settings.mcp.addPair')}
      </button>
    </div>
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

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-caption font-medium uppercase tracking-wide text-ink-tertiary">{label}</div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function ChoiceCard({
  selected,
  title,
  desc,
  onClick,
}: {
  selected: boolean
  title: string
  desc: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        'flex-1 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        selected ? 'border-accent bg-accent-subtle' : 'border-border hover:bg-surface-muted',
      )}
    >
      <div className="flex items-center justify-between">
        <span className={cn('text-body font-medium', selected ? 'text-accent-strong' : 'text-ink')}>{title}</span>
        <span
          className={cn(
            'flex h-4 w-4 items-center justify-center rounded-full border',
            selected ? 'border-accent bg-accent text-white' : 'border-border',
          )}
        >
          {selected && <Check size={11} />}
        </span>
      </div>
      <div className={cn('mt-1 text-caption', selected ? 'text-accent-strong/80' : 'text-ink-tertiary')}>{desc}</div>
    </button>
  )
}
