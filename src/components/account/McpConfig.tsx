import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Plug, Plus, Pencil, Trash2, Check, X, RefreshCw, ChevronDown, Server, AlertCircle, Cpu } from 'lucide-react'
import { nanoid } from 'nanoid'
import type { ClientMessage, McpServerConfig, PluginMeta } from '@hip/protocol'
import { useHipConfigStore, useMcpServers } from '@/store/hipConfigStore'
import { wsClient } from '@/ipc/ws-client'
import { usePluginsStore } from '@/store/pluginsStore'
import { useMcpStatuses, type McpServerStatusVM } from '@/domain'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'

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

/** UI helper: translate a connection status to a readable label. */
function getStatusLabel(t: TFunction, status: McpServerStatusVM['status']): string {
  switch (status) {
    case 'connected': return t('settings.mcp.statusConnected')
    case 'connecting': return t('settings.mcp.statusConnecting')
    case 'disconnected': return t('settings.mcp.statusDisconnected')
    case 'error': return t('settings.mcp.statusError')
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

/** Pure helper: derive read-only plugin-contributed MCP servers, excluding duplicates already owned by standalone configs or earlier plugins. */
export function derivePluginMcpServers(
  plugins: PluginMeta[],
  standaloneIds: Set<string>,
): Array<McpServerConfig & { pluginId: string; pluginName: string }> {
  const seen = new Set<string>()
  const out: Array<McpServerConfig & { pluginId: string; pluginName: string }> = []
  for (const plugin of plugins) {
    for (const server of plugin.mcpServers) {
      if (standaloneIds.has(server.id)) continue
      if (seen.has(server.id)) continue
      seen.add(server.id)
      out.push({ ...server, pluginId: plugin.id, pluginName: plugin.name })
    }
  }
  return out
}

export function McpConfig() {
  const { t } = useTranslation()
  const servers = useMcpServers()
  const { loaded, load, updateSection } = useHipConfigStore()
  const { plugins, loaded: pluginsLoaded, load: loadPlugins } = usePluginsStore()
  const mcpStatuses = useMcpStatuses()
  const [editing, setEditing] = useState<Editing>(null)
  const [deleting, setDeleting] = useState<McpServerConfig | null>(null)

	  const addServer = async (s: Omit<McpServerConfig, 'id'>) => {
	    await updateSection('mcpServers', (prev) => [...(prev ?? []), { ...s, id: nanoid() }])
	  }
	  const updateServer = async (id: string, patch: Partial<McpServerConfig>) => {
	    await updateSection('mcpServers', (prev) =>
	      (prev ?? []).map((s) => (s.id === id ? { ...s, ...patch } : s)),
	    )
	  }
	  const removeServer = async (id: string) => {
	    await updateSection('mcpServers', (prev) => (prev ?? []).filter((s) => s.id !== id))
	  }

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  useEffect(() => {
    if (!pluginsLoaded) void loadPlugins()
  }, [pluginsLoaded, loadPlugins])

  const statusByServer = useMemo(() => new Map(mcpStatuses.map((s) => [s.id, s])), [mcpStatuses])
  const pluginMcpServers = useMemo(
    () => derivePluginMcpServers(plugins, new Set(servers.map((s) => s.id))),
    [plugins, servers],
  )

  const stats = useMemo(() => {
    const enabledCount = servers.filter((s) => s.enabled).length
    const connectedCount = mcpStatuses.filter((s) => s.status === 'connected').length
    const errorCount = mcpStatuses.filter((s) => s.status === 'error').length
    const toolCount = mcpStatuses.reduce((sum, s) => sum + (s.toolCount ?? 0), 0)
    return { enabledCount, connectedCount, errorCount, toolCount, total: servers.length }
  }, [servers, mcpStatuses])

  const handleUpdateTools = async (
    server: McpServerConfig,
    toolName: string,
  ) => {
    const result = toggleTool(toolName, server.enabledTools ?? [], server.disabledTools ?? [])
    await updateServer(server.id, result)
  }

  const handleResetTools = async (server: McpServerConfig) => {
    await updateServer(server.id, { enabledTools: [], disabledTools: [] })
  }

  const reconnectMcpServers = useCallback(() => {
    const allServers: McpServerConfig[] = [...servers, ...pluginMcpServers]
    const msg: ClientMessage = { type: 'mcp:reconnect', servers: allServers }
    wsClient.send(msg)
  }, [servers, pluginMcpServers])

  // Ask the sidecar for the current MCP status as soon as the page has both
  // standalone and plugin server configs loaded. Without this the list stays
  // blank until the user manually hits the refresh button.
  const statusRequestedRef = useRef(false)
  useEffect(() => {
    if (!loaded || !pluginsLoaded || statusRequestedRef.current) return
    if (servers.length === 0 && pluginMcpServers.length === 0) return
    statusRequestedRef.current = true
    reconnectMcpServers()
  }, [loaded, pluginsLoaded, servers, pluginMcpServers, reconnectMcpServers])

  return (
    <div className="p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-title font-semibold text-ink">{t('settings.mcp.title')}</h2>
          <p className="mt-1 text-body text-ink-secondary">{t('settings.mcp.intro')}</p>
        </div>
        <Button size="sm" onClick={() => setEditing({ mode: 'add' })}>
          <Plus size={15} />
          {t('settings.mcp.add')}
        </Button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          icon={Plug}
          value={`${stats.enabledCount}/${stats.total}`}
          label={t('settings.mcp.statEnabled')}
          tone="accent"
        />
        <StatCard
          icon={Server}
          value={String(stats.connectedCount)}
          label={t('settings.mcp.statConnected')}
          tone="success"
        />
        <StatCard
          icon={AlertCircle}
          value={String(stats.errorCount)}
          label={t('settings.mcp.statErrors')}
          tone={stats.errorCount > 0 ? 'danger' : 'muted'}
        />
        <StatCard
          icon={Cpu}
          value={String(stats.toolCount)}
          label={t('settings.mcp.statTools')}
          tone="muted"
        />
      </div>

      <div className="mt-6">
        <h3 className="text-subtitle font-medium text-ink">{t('settings.mcp.myServersTitle')}</h3>
        <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {servers.length === 0 ? (
            <button
              onClick={() => setEditing({ mode: 'add' })}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-8 text-body font-medium text-accent-strong transition-colors hover:bg-accent-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <Plug size={24} />
              <span>{t('settings.mcp.empty')}</span>
            </button>
          ) : (
            servers.map((s) => (
              <McpServerCard
                key={s.id}
                server={s}
                status={statusByServer.get(s.id)}
                onToggle={(enabled) => { updateServer(s.id, { enabled }).catch((err) => console.error('Failed to update MCP server:', err)) }}
                onEdit={() => setEditing({ mode: 'edit', server: s })}
                onDelete={() => setDeleting(s)}
                onToggleTool={(toolName) => { handleUpdateTools(s, toolName).catch((err) => console.error('Failed to update MCP tools:', err)) }}
                onResetTools={() => { handleResetTools(s).catch((err) => console.error('Failed to reset MCP tools:', err)) }}
                onReconnect={reconnectMcpServers}
              />
            ))
          )}
        </div>
      </div>

      {pluginMcpServers.length > 0 && (
        <div className="mt-6">
          <h3 className="text-subtitle font-medium text-ink">{t('settings.mcp.pluginSectionTitle')}</h3>
          <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {pluginMcpServers.map((s) => (
              <PluginMcpServerCard
                key={s.id}
                server={s}
                pluginName={s.pluginName}
                status={statusByServer.get(s.id)}
              />
            ))}
          </div>
        </div>
      )}

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
          onConfirm={async () => {
            try {
              await removeServer(deleting.id)
              setDeleting(null)
            } catch (err) {
              console.error('Failed to remove MCP server:', err)
            }
          }}
        />
      )}
    </div>
  )
}

function StatCard({
  icon: Icon,
  value,
  label,
  tone,
}: {
  icon: React.ElementType
  value: string
  label: string
  tone: 'accent' | 'success' | 'danger' | 'muted'
}) {
  const toneClasses = {
    accent: 'bg-accent-subtle text-accent-strong',
    success: 'bg-success/10 text-success',
    danger: 'bg-danger/10 text-danger',
    muted: 'bg-surface-muted text-ink-secondary',
  }
  return (
    <div className="rounded-xl border border-border bg-surface p-4 transition-shadow hover:shadow-card-hover">
      <div className="flex items-center gap-2">
        <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', toneClasses[tone])}>
          <Icon size={16} />
        </span>
      </div>
      <div className="mt-2 text-stat font-semibold tracking-tight text-ink">{value}</div>
      <div className="text-caption text-ink-tertiary">{label}</div>
    </div>
  )
}

function StatusDot({ status }: { status: McpServerStatusVM['status'] }) {
  const colors = {
    connected: 'bg-success',
    connecting: 'bg-warning animate-pulse',
    disconnected: 'bg-ink-tertiary',
    error: 'bg-danger',
  }
  return (
    <span
      className={cn('inline-block h-2 w-2 rounded-full', colors[status])}
      aria-hidden="true"
    />
  )
}

function McpServerCard({
  server,
  status,
  onToggle,
  onEdit,
  onDelete,
  onToggleTool,
  onResetTools,
  onReconnect,
}: {
  server: McpServerConfig
  status?: McpServerStatusVM
  onToggle: (enabled: boolean) => void
  onEdit: () => void
  onDelete: () => void
  onToggleTool: (toolName: string) => void
  onResetTools: () => void
  onReconnect: () => void
}) {
  const { t } = useTranslation()
  const [toolsOpen, setToolsOpen] = useState(false)
  const transportLabel =
    server.transport === 'stdio'
      ? t('settings.mcp.transportStdio')
      : server.transport === 'sse'
        ? t('settings.mcp.transportSse')
        : t('settings.mcp.transportHttp')
  const detail =
    server.transport === 'stdio' ? [server.command, ...(server.args ?? [])].join(' ') : (server.url ?? '')
  const statusLabel = status ? getStatusLabel(t, status.status) : null
  const statusTitle = status?.lastError ? `${statusLabel}: ${status.lastError}` : statusLabel || undefined
  const toolCount = status?.toolCount ?? 0
  const discoveredTools = status?.toolNames ?? []
  const hasTools = discoveredTools.length > 0

  return (
    <div
      className={cn(
        'relative flex min-h-[180px] flex-col rounded-lg border border-border bg-surface p-4 transition-shadow hover:shadow-card-hover',
        !server.enabled && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-subtle text-accent-strong">
          <Plug size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-body font-medium text-ink">{server.name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge>{transportLabel}</Badge>
            {status && (
              <span
                className="inline-flex items-center gap-1 text-caption text-ink-secondary"
                title={statusTitle}
              >
                <StatusDot status={status.status} />
                {statusLabel}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 flex-1">
        <div className="truncate font-mono text-caption text-ink-tertiary">{detail}</div>
        {status && (
          <div className="mt-2 flex items-center gap-3 text-caption text-ink-tertiary">
            <span>
              {toolCount} {toolCount === 1 ? t('settings.mcp.toolSingular') : t('settings.mcp.toolPlural')}
            </span>
            {hasTools && (
              <button
                onClick={() => setToolsOpen((o) => !o)}
                className="inline-flex items-center gap-0.5 text-accent-strong transition-colors hover:text-accent"
              >
                {t('settings.mcp.manageTools')}
                <ChevronDown size={14} className={cn('transition-transform', toolsOpen && 'rotate-180')} />
              </button>
            )}
          </div>
        )}
        {toolsOpen && hasTools && (
          <div className="mt-3 rounded-lg border border-border bg-surface-subtle p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-caption font-medium uppercase tracking-wide text-ink-tertiary">
                {t('settings.mcp.sectionTools')}
              </span>
              {(server.enabledTools?.length || server.disabledTools?.length) ? (
                <button
                  type="button"
                  onClick={() => { onResetTools() }}
                  className="text-caption text-accent hover:underline"
                >
                  {t('settings.mcp.toolToggleAll')}
                </button>
              ) : null}
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {discoveredTools.map((toolName) => {
                const enabled = resolveToolEnabled(toolName, server.enabledTools ?? [], server.disabledTools ?? [])
                return (
                  <label
                    key={toolName}
                    className="flex items-center gap-2 rounded-md p-1.5 hover:bg-surface-muted cursor-pointer"
                  >
                    <Switch
                      checked={enabled}
                      onCheckedChange={() => onToggleTool(toolName)}
                      ariaLabel={toolName}
                    />
                    <span className="truncate font-mono text-body text-ink-secondary">{toolName}</span>
                  </label>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <Switch checked={server.enabled} onCheckedChange={onToggle} ariaLabel={t('settings.mcp.enableThis')} />
        <div className="flex items-center gap-1">
          {status?.status === 'disconnected' && server.enabled && (
            <ActionButton icon={<RefreshCw size={14} />} label={t('settings.mcp.reconnect')} onClick={onReconnect} />
          )}
          <ActionButton icon={<Pencil size={14} />} label={t('settings.mcp.edit')} onClick={onEdit} />
          <ActionButton icon={<Trash2 size={14} />} label={t('settings.mcp.delete')} onClick={onDelete} danger />
        </div>
      </div>
    </div>
  )
}

function PluginMcpServerCard({
  server,
  pluginName,
  status,
}: {
  server: McpServerConfig
  pluginName: string
  status?: McpServerStatusVM
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
  const statusLabel = status ? getStatusLabel(t, status.status) : null
  const statusTitle = status?.lastError ? `${statusLabel}: ${status.lastError}` : statusLabel || undefined
  const toolCount = status?.toolCount

  return (
    <div
      className={cn(
        'relative flex min-h-[140px] flex-col rounded-lg border border-border bg-surface p-4',
        !server.enabled && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-subtle text-accent-strong">
          <Plug size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-body font-medium text-ink">{server.name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Badge>{transportLabel}</Badge>
            <Badge className="bg-accent-subtle text-accent-strong">{t('settings.mcp.via', { name: pluginName })}</Badge>
            {status && (
              <span
                className="inline-flex items-center gap-1 text-caption text-ink-secondary"
                title={statusTitle}
              >
                <StatusDot status={status.status} />
                {statusLabel}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="mt-3 flex-1">
        <div className="truncate font-mono text-caption text-ink-tertiary">{detail}</div>
        {toolCount !== undefined && (
          <div className="mt-2 text-caption text-ink-tertiary">
            {toolCount} {toolCount === 1 ? t('settings.mcp.toolSingular') : t('settings.mcp.toolPlural')}
          </div>
        )}
      </div>
    </div>
  )
}

function ActionButton({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        danger
          ? 'text-ink-secondary hover:bg-danger/10 hover:text-danger'
          : 'text-ink-secondary hover:bg-surface-muted hover:text-ink',
      )}
      aria-label={label}
    >
      {icon}
    </button>
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

  const footer = (
    <div className="flex items-center gap-2">
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
  )

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onCancel()
      }}
      title={initial ? t('settings.mcp.editTitle') : t('settings.mcp.addTitle')}
      footer={footer}
    >
      <div className="space-y-5 p-5">
        <Field label={t('settings.mcp.name')}>
          <input className={inputCls} value={form.name} onChange={(e) => patch({ name: e.target.value })} placeholder={t('settings.mcp.namePlaceholder')} />
        </Field>

        <Section label={t('settings.mcp.sectionTransport')}>
          <div role="radiogroup" aria-label={t('settings.mcp.sectionTransport')} className="flex flex-col gap-2">
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
                <div className="mt-2 flex items-center gap-2">
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
                <div className="mt-1 max-h-40 space-y-1 overflow-y-auto">
                  {discoveredTools.map((toolName) => {
                    const enabled = resolveToolEnabled(toolName, form.enabledTools, form.disabledTools)
                    return (
                      <label
                        key={toolName}
                        className="flex items-center gap-2 rounded px-1 py-1 hover:bg-surface-muted cursor-pointer"
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
              <div className="mt-1 text-caption text-ink-tertiary">{t('settings.mcp.noToolsDiscovered')}</div>
            )}
          </Section>
        )}

        {error && <div className="text-meta text-danger">{error}</div>}
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
        'flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        selected ? 'border-accent bg-accent-subtle' : 'border-border hover:bg-surface-muted',
      )}
    >
      <span
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
          selected ? 'border-accent bg-accent text-white' : 'border-border',
        )}
      >
        {selected && <Check size={11} />}
      </span>
      <div>
        <div className={cn('text-body font-medium', selected ? 'text-accent-strong' : 'text-ink')}>{title}</div>
        <div className={cn('text-caption', selected ? 'text-accent-strong/80' : 'text-ink-tertiary')}>{desc}</div>
      </div>
    </button>
  )
}
