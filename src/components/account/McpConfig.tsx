import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  Plug,
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  RefreshCw,
  ChevronDown,
  Server,
  Settings2,
  Search,
  Package,
  Download,
  Box,
} from 'lucide-react'
import { nanoid } from 'nanoid'
import type {
  ClientMessage,
  McpRegistryEntry,
  McpServerConfig,
  PluginMeta,
} from '@hip/protocol'
import { useHipConfigStore, useMcpServers } from '@/store/hipConfigStore'
import {
  filterMcpRegistryEntries,
  overlayMcpInstallState,
  useMcpRegistryStore,
} from '@/store/mcpRegistryStore'
import { wsClient } from '@/ipc/ws-client'
import { usePluginsStore } from '@/store/pluginsStore'
import { useMcpStatuses, type McpServerStatusVM } from '@/domain'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input, inputClassName } from '@/components/ui/Input'
import { EmptyState as UiEmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { Pagination } from '@/components/ui/Pagination'
import { DeclarativeContextMenu } from '@/components/context-menu'
import { paginateItems, PLUGIN_MARKET_PAGE_SIZE } from './PluginConfigView'

const MCP_MARKET_PAGE_SIZE = PLUGIN_MARKET_PAGE_SIZE
import { McpRegistrySourceModal } from './McpRegistrySourceModal'
import {
  buildMcpRegistryInstallDraft,
  isMcpRegistryEntryInstallable,
  mcpRegistryInstallMethod,
} from '@/lib/mcpRegistryInstall'

import {
  buildMcpDraft,
  isMcpDraftValid,
  mcpConfigToForm,
  EMPTY_MCP_FORM,
  type McpForm,
  type KvPair,
} from '@/lib/mcpServerDraft'
import { ExtensionConflictsBanner } from './ExtensionConflictsBanner'
import { useExtensionStore } from '@/store/extensionStore'
import { derivePluginMcpFromSnapshot } from '@/lib/extensionSnapshot'

const inputCls = inputClassName

type Editing =
  | { mode: 'add' }
  | { mode: 'edit'; server: McpServerConfig }
  | { mode: 'install'; initial: McpServerConfig }
  | null

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

/** Pure helper: derive read-only plugin-contributed MCP servers, excluding duplicates already owned by standalone configs or earlier plugins.
 *  When the parent plugin is disabled in the market, the server is forced `enabled: false`. */
export function derivePluginMcpServers(
  plugins: PluginMeta[],
  standaloneIds: Set<string>,
): Array<McpServerConfig & { pluginId: string; pluginName: string; pluginEnabled: boolean }> {
  const seen = new Set<string>()
  const out: Array<McpServerConfig & { pluginId: string; pluginName: string; pluginEnabled: boolean }> = []
  for (const plugin of plugins) {
    const pluginEnabled = plugin.enabled === true
    for (const server of plugin.mcpServers) {
      if (standaloneIds.has(server.id)) continue
      if (seen.has(server.id)) continue
      seen.add(server.id)
      out.push({
        ...server,
        // Parent plugin off ⇒ MCP is off for UI + reconnect payloads.
        enabled: pluginEnabled && server.enabled !== false,
        pluginId: plugin.id,
        pluginName: plugin.name,
        pluginEnabled,
      })
    }
  }
  return out
}

export function McpConfig() {
  const { t } = useTranslation()
  const servers = useMcpServers()
  const { loaded, load, updateSection } = useHipConfigStore()
  const { plugins, loaded: pluginsLoaded, load: loadPlugins } = usePluginsStore()
  const snapshot = useExtensionStore((s) => s.snapshot)
  const mcpStatuses = useMcpStatuses()
  const market = useMcpRegistryStore()
  const [editing, setEditing] = useState<Editing>(null)
  const [deleting, setDeleting] = useState<McpServerConfig | null>(null)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [marketError, setMarketError] = useState<string | null>(null)

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

  const marketLoad = useMcpRegistryStore((s) => s.load)
  const marketRefresh = useMcpRegistryStore((s) => s.refresh)
  const marketLoaded = useMcpRegistryStore((s) => s.loaded)
  const marketTab = useMcpRegistryStore((s) => s.tab)
  const marketSources = useMcpRegistryStore((s) => s.sources)
  const marketRefreshing = useMcpRegistryStore((s) => s.refreshing)
  const marketEntriesRaw = useMcpRegistryStore((s) => s.entries)
  const marketQuery = useMcpRegistryStore((s) => s.query)

  useEffect(() => {
    if (!marketLoaded) void marketLoad()
  }, [marketLoaded, marketLoad])

  // Auto-refresh once per mount when catalog is missing or still the offline seed.
  // Seed-only catalogs report lastFetchedAt=null from Rust after migration.
  const autoRefreshAttempted = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (marketTab === 'custom') return
    if (!marketLoaded) return
    const src = marketSources.find((s) => s.id === marketTab)
    if (!src?.enabled || marketRefreshing) return
    if (autoRefreshAttempted.current.has(marketTab)) return
    const catalogSize =
      src.serverCount ??
      marketEntriesRaw.filter((e) => e.marketSourceId === marketTab).length
    // No lastFetchedAt ⇒ never live-fetched (or seed-only). Small catalogs also force refresh.
    const needsRefresh = !src.lastFetchedAt || catalogSize <= 1
    if (!needsRefresh) return
    autoRefreshAttempted.current.add(marketTab)
    void marketRefresh(marketTab)
  }, [
    marketTab,
    marketSources,
    marketRefreshing,
    marketRefresh,
    marketEntriesRaw,
    marketLoaded,
  ])

  const marketEntries = useMemo(() => {
    const overlaid = overlayMcpInstallState(marketEntriesRaw, servers)
    return filterMcpRegistryEntries(overlaid, marketTab, marketQuery)
  }, [marketEntriesRaw, marketTab, marketQuery, servers])

  const [marketPage, setMarketPage] = useState(1)
  const marketTotalPages = Math.max(1, Math.ceil(marketEntries.length / MCP_MARKET_PAGE_SIZE))
  const safeMarketPage = Math.min(marketPage, marketTotalPages)
  useEffect(() => {
    setMarketPage(1)
  }, [marketTab, marketQuery])
  useEffect(() => {
    if (marketPage > marketTotalPages) setMarketPage(marketTotalPages)
  }, [marketPage, marketTotalPages])
  const pageMarketEntries = useMemo(
    () => paginateItems(marketEntries, safeMarketPage, MCP_MARKET_PAGE_SIZE),
    [marketEntries, safeMarketPage],
  )

  const statusByServer = useMemo(() => new Map(mcpStatuses.map((s) => [s.id, s])), [mcpStatuses])
  const standaloneIds = useMemo(() => new Set(servers.map((s) => s.id)), [servers])
  /** Prefer registry snapshot so UI matches agent; fall back to manifest derive. */
  const pluginMcpServers = useMemo(() => {
    if (snapshot) {
      return derivePluginMcpFromSnapshot(snapshot, plugins, standaloneIds).map((row) => ({
        ...row,
        // Session reconnect: only enabled when registry-active and parent on
        enabled: row.registryActive && row.enabled !== false && row.pluginEnabled !== false,
        pluginId: row.pluginId ?? '',
        pluginName: row.pluginName ?? row.pluginId ?? 'plugin',
        pluginEnabled: row.pluginEnabled === true,
        registryActive: row.registryActive,
        shadowedReason: row.shadowedReason,
      }))
    }
    return derivePluginMcpServers(plugins, standaloneIds).map((s) => ({
      ...s,
      registryActive: s.enabled,
      shadowedReason: undefined as string | undefined,
    }))
  }, [snapshot, plugins, standaloneIds, servers])

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
    // Prefer snapshot active set when available (single source of truth).
    const fromSnapshot = snapshot
      ? snapshot.mcpServers.filter((r) => r.active).map((r) => r.config)
      : null
    const activePlugin = pluginMcpServers.filter((s) => s.enabled)
    const allServers: McpServerConfig[] = fromSnapshot ?? [...servers, ...activePlugin]
    const msg: ClientMessage = { type: 'mcp:reconnect', servers: allServers }
    wsClient.send(msg)
  }, [servers, pluginMcpServers, snapshot])

  const statusRequestedRef = useRef(false)
  const pluginEnableKey = plugins.map((p) => `${p.id}:${p.enabled}`).join('|')
  useEffect(() => {
    if (!loaded || !pluginsLoaded) return
    if (servers.length === 0 && pluginMcpServers.length === 0) return
    if (!statusRequestedRef.current) {
      statusRequestedRef.current = true
      reconnectMcpServers()
      return
    }
    reconnectMcpServers()
  }, [loaded, pluginsLoaded, servers, pluginMcpServers, pluginEnableKey, reconnectMcpServers])

  const handleMarketInstall = (entry: McpRegistryEntry) => {
    const draft = buildMcpRegistryInstallDraft(entry)
    if (!draft) {
      setMarketError(t('settings.mcp.installNotSupported'))
      return
    }
    setMarketError(null)
    const initial: McpServerConfig = {
      id: '',
      name: draft.name,
      transport: draft.transport,
      command: draft.command,
      args: draft.args,
      env: draft.env,
      url: draft.url,
      headers: draft.headers,
      enabled: true,
      registryName: draft.registryName,
      registrySourceId: draft.registrySourceId,
      registryVersion: draft.registryVersion,
    }
    setEditing({ mode: 'install', initial })
  }

  const handleMarketUninstall = (entry: McpRegistryEntry) => {
    if (!entry.localServerId) return
    const server = servers.find((s) => s.id === entry.localServerId)
    if (server) setDeleting(server)
  }

  const handleMarketToggle = async (entry: McpRegistryEntry, enabled: boolean) => {
    if (!entry.localServerId) return
    setMarketError(null)
    try {
      await updateServer(entry.localServerId, { enabled })
    } catch (err) {
      setMarketError(err instanceof Error ? err.message : t('settings.mcp.error'))
    }
  }

  const activeSource = marketTab !== 'custom'
    ? marketSources.find((s) => s.id === marketTab)
    : undefined
  const sourceDisabled = Boolean(activeSource && activeSource.enabled === false)
  const combinedError = marketError ?? market.error

  const navItems = useMemo(() => {
    const items: { id: string; label: string; icon: typeof Package; count?: number }[] = []
    for (const src of marketSources) {
      items.push({
        id: src.id,
        label: src.name,
        icon: Box,
        count: src.serverCount,
      })
    }
    items.push({
      id: 'custom',
      label: t('settings.mcp.tabCustom'),
      icon: Package,
      count: servers.length,
    })
    return items
  }, [marketSources, servers.length, t])

  return (
    <div className="flex min-h-0 flex-col" data-testid="mcp-config">
      <div className="shrink-0 border-b border-border px-6 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-title font-semibold text-ink">{t('settings.mcp.title')}</h2>
            <p className="mt-1 text-body text-ink-secondary">{t('settings.mcp.intro')}</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSourcesOpen(true)}
              data-testid="mcp-registry-sources-open"
            >
              <Settings2 size={14} /> {t('settings.mcp.manageSources')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={marketRefreshing || marketTab === 'custom'}
              onClick={() => void marketRefresh(marketTab === 'custom' ? undefined : marketTab)}
              data-testid="mcp-registry-refresh"
            >
              <RefreshCw size={14} className={marketRefreshing ? 'animate-spin' : undefined} />{' '}
              {t('settings.mcp.refreshCatalog')}
            </Button>
            {marketTab === 'custom' && (
              <Button
                type="button"
                variant="primary"
                size="sm"
                className="gap-1.5"
                onClick={() => setEditing({ mode: 'add' })}
              >
                <Plus size={14} />
                {t('settings.mcp.add')}
              </Button>
            )}
          </div>
        </div>
        <div className="mt-3">
          <ExtensionConflictsBanner />
        </div>
      </div>

      <div className="flex h-[min(36rem,calc(100vh-14rem))] min-h-[28rem] flex-1">
        <aside
          className="flex w-44 shrink-0 flex-col border-r border-border bg-surface-subtle/40"
          data-testid="mcp-registry-sidebar"
        >
          <nav
            className="flex flex-1 flex-col gap-0.5 p-2"
            aria-label={t('settings.mcp.tabsAria')}
          >
            {navItems.map((item) => {
              const Icon = item.icon
              const selected = marketTab === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  data-testid={`mcp-registry-tab-${item.id}`}
                  onClick={() => market.setTab(item.id)}
                  className={cn(
                    'relative flex h-9 items-center gap-2 rounded-lg px-2.5 text-left text-meta font-medium transition-colors duration-chrome',
                    'text-ink-secondary hover:bg-state-hover hover:text-ink',
                    'before:absolute before:inset-y-1.5 before:left-0 before:w-[2px] before:rounded-full before:bg-accent before:opacity-0',
                    selected && 'bg-state-hover text-ink before:opacity-100',
                  )}
                >
                  <Icon size={15} strokeWidth={1.75} className="shrink-0 opacity-70" />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.count != null && item.count > 0 && (
                    <span className="shrink-0 tabular-nums text-caption text-ink-tertiary">
                      {item.count}
                    </span>
                  )}
                </button>
              )
            })}
          </nav>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="shrink-0 space-y-3 border-b border-border px-5 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-[12rem] max-w-md flex-1">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-tertiary"
                />
                <Input
                  className="pl-8"
                  value={marketQuery}
                  onChange={(e) => market.setQuery(e.target.value)}
                  placeholder={t('settings.mcp.searchPlaceholder')}
                  data-testid="mcp-registry-search"
                />
              </div>
              {marketTab !== 'custom' && marketEntries.length > 0 && (
                <div className="flex shrink-0 flex-wrap items-center gap-3">
                  <span className="text-caption text-ink-tertiary">
                    {t('settings.mcp.pageSummary', {
                      total: marketEntries.length,
                      page: safeMarketPage,
                      pages: marketTotalPages,
                    })}
                  </span>
                  <Pagination
                    currentPage={safeMarketPage}
                    totalPages={marketTotalPages}
                    onChange={setMarketPage}
                    previousLabel={t('settings.mcp.previousPage')}
                    nextLabel={t('settings.mcp.nextPage')}
                  />
                </div>
              )}
            </div>
            {combinedError && (
              <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-meta text-danger">
                {combinedError}
              </div>
            )}
            {!combinedError && activeSource?.lastError && (
              <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-meta text-danger">
                {t('settings.mcp.refreshFailed')}: {activeSource.lastError}
              </div>
            )}
            {marketRefreshing && marketTab !== 'custom' && (
              <div className="rounded-md border border-border bg-surface-subtle px-3 py-2 text-meta text-ink-secondary">
                {t('settings.mcp.refreshingHint')}
              </div>
            )}
            {sourceDisabled && (
              <div className="rounded-md border border-border bg-surface-subtle px-3 py-2 text-meta text-ink-secondary">
                {t('settings.mcp.sourceDisabledBanner')}
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {marketTab === 'custom' ? (
              <div className="space-y-6">
                <div>
                  <h3 className="text-subtitle font-medium text-ink">
                    {t('settings.mcp.myServersTitle')}
                  </h3>
                  <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {servers.length === 0 ? (
                      <button
                        onClick={() => setEditing({ mode: 'add' })}
                        className="col-span-full flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border py-8 text-body font-medium text-accent-strong transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
                      >
                        <Plug size={24} />
                        <span>{t('settings.mcp.empty')}</span>
                      </button>
                    ) : (
                      servers
                        .filter((s) => {
                          const q = marketQuery.trim().toLowerCase()
                          if (!q) return true
                          return [s.name, s.command, s.url, s.registryName]
                            .filter(Boolean)
                            .join(' ')
                            .toLowerCase()
                            .includes(q)
                        })
                        .map((s) => (
                          <McpServerCard
                            key={s.id}
                            server={s}
                            status={statusByServer.get(s.id)}
                            onToggle={async (enabled) => {
                              await updateServer(s.id, { enabled })
                            }}
                            onEdit={() => setEditing({ mode: 'edit', server: s })}
                            onDelete={() => setDeleting(s)}
                            onToggleTool={async (toolName) => {
                              await handleUpdateTools(s, toolName)
                            }}
                            onResetTools={async () => {
                              await handleResetTools(s)
                            }}
                            onReconnect={reconnectMcpServers}
                          />
                        ))
                    )}
                  </div>
                </div>

                {pluginMcpServers.length > 0 && (
                  <div>
                    <h3 className="text-subtitle font-medium text-ink">
                      {t('settings.mcp.pluginSectionTitle')}
                    </h3>
                    <p className="mt-1 text-caption text-ink-tertiary">
                      {t('settings.mcp.pluginSectionHint')}
                    </p>
                    <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {pluginMcpServers.map((s) => (
                        <PluginMcpServerCard
                          key={s.id}
                          server={s}
                          pluginName={s.pluginName}
                          pluginEnabled={s.pluginEnabled}
                          registryActive={s.registryActive}
                          shadowedReason={s.shadowedReason}
                          status={statusByServer.get(s.id)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : market.loading && !market.loaded ? (
              <div className="space-y-3" data-testid="mcp-registry-loading">
                <p className="text-body text-ink-tertiary">{t('settings.mcp.loading')}</p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  <Skeleton className="h-28 rounded-xl" />
                  <Skeleton className="h-28 rounded-xl" />
                  <Skeleton className="h-28 rounded-xl" />
                </div>
              </div>
            ) : marketEntries.length === 0 ? (
              <UiEmptyState
                icon={Package}
                tier="professional"
                title={
                  marketQuery.trim()
                    ? t('settings.mcp.noSearchResults')
                    : t('settings.mcp.marketEmpty')
                }
                description={
                  marketQuery.trim()
                    ? t('settings.mcp.noSearchResultsHint')
                    : t('settings.mcp.marketEmptyHint')
                }
                className="border border-dashed border-border bg-surface-subtle"
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {pageMarketEntries.map((entry) => (
                  <McpRegistryCard
                    key={entry.key}
                    entry={entry}
                    onInstall={() => handleMarketInstall(entry)}
                    onToggle={(on) => void handleMarketToggle(entry, on)}
                    onUninstall={() => handleMarketUninstall(entry)}
                    t={t}
                  />
                ))}
              </div>
            )}
          </div>

          {marketTab !== 'custom' && marketEntries.length > 0 && (
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-surface px-5 py-2.5">
              <span className="text-caption text-ink-tertiary">
                {t('settings.mcp.pageSummary', {
                  total: marketEntries.length,
                  page: safeMarketPage,
                  pages: marketTotalPages,
                })}
              </span>
              <Pagination
                currentPage={safeMarketPage}
                totalPages={marketTotalPages}
                onChange={setMarketPage}
                previousLabel={t('settings.mcp.previousPage')}
                nextLabel={t('settings.mcp.nextPage')}
              />
            </div>
          )}
        </div>
      </div>

      {editing && (
        <McpServerEditor
          initial={
            editing.mode === 'edit'
              ? editing.server
              : editing.mode === 'install'
                ? editing.initial
                : null
          }
          status={editing.mode === 'edit' ? statusByServer.get(editing.server.id) : undefined}
          onCancel={() => setEditing(null)}
          onSave={async (draft) => {
            if (editing.mode === 'edit') {
              await updateServer(editing.server.id, {
                ...draft,
                registryName: editing.server.registryName,
                registrySourceId: editing.server.registrySourceId,
                registryVersion: editing.server.registryVersion,
              })
            } else if (editing.mode === 'install') {
              await addServer({
                ...draft,
                registryName: editing.initial.registryName,
                registrySourceId: editing.initial.registrySourceId,
                registryVersion: editing.initial.registryVersion,
              })
            } else {
              await addServer(draft)
            }
            setEditing(null)
          }}
        />
      )}

      {deleting && (
        <DeleteServerDialog
          server={deleting}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            await removeServer(deleting.id)
            setDeleting(null)
          }}
        />
      )}

      <McpRegistrySourceModal
        open={sourcesOpen}
        sources={market.sources}
        refreshing={market.refreshing}
        adding={market.adding}
        onClose={() => setSourcesOpen(false)}
        onToggle={(id, enabled) => {
          void market.setSourceEnabled(id, enabled)
        }}
        onRefresh={(id) => {
          void market.refresh(id)
        }}
        onAdd={async (url) => {
          await market.addSource(url)
        }}
        onRemove={async (id) => {
          await market.removeSource(id)
        }}
        t={t}
      />
    </div>
  )
}

function McpRegistryCard({
  entry,
  onInstall,
  onToggle,
  onUninstall,
  t,
}: {
  entry: McpRegistryEntry
  onInstall: () => void
  onToggle: (enabled: boolean) => void
  onUninstall: () => void
  t: TFunction
}) {
  const installed = entry.installState === 'installed'
  const installable = isMcpRegistryEntryInstallable(entry)
  const method = mcpRegistryInstallMethod(entry)
  const title = entry.title?.trim() || entry.name.split('/').pop() || entry.name

  return (
    <div
      data-testid="mcp-registry-card"
      className={cn(
        'relative flex min-h-[160px] flex-col rounded-lg border border-border bg-surface p-4 transition-colors hover:bg-surface-subtle',
        installed && !entry.enabled && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-subtle text-accent-strong">
          <Server size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-body font-medium text-ink">{title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {method && <Badge>{method}</Badge>}
            {entry.version && (
              <span className="text-caption text-ink-tertiary">v{entry.version}</span>
            )}
            {installed && (
              <Badge className="bg-success/10 text-success">
                {t('settings.mcp.installedBadge')}
              </Badge>
            )}
          </div>
        </div>
      </div>
      <div className="mt-3 flex-1">
        <div className="line-clamp-2 text-meta text-ink-secondary">
          {entry.description || entry.name}
        </div>
        <div className="mt-1 truncate font-mono text-caption text-ink-tertiary">{entry.name}</div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-2">
        {installed ? (
          <>
            <Switch
              checked={entry.enabled}
              onCheckedChange={onToggle}
              ariaLabel={t('settings.mcp.enableThis')}
            />
            <Button variant="outline" size="sm" onClick={onUninstall}>
              {t('settings.mcp.uninstall')}
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            size="sm"
            className="gap-1.5"
            disabled={!installable}
            title={entry.installBlockedReason || undefined}
            onClick={onInstall}
          >
            <Download size={14} />
            {t('settings.mcp.install')}
          </Button>
        )}
      </div>
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
  onToggle: (enabled: boolean) => Promise<void>
  onEdit: () => void
  onDelete: () => void
  onToggleTool: (toolName: string) => Promise<void>
  onResetTools: () => Promise<void>
  onReconnect: () => void
}) {
  const { t } = useTranslation()
  const [toolsOpen, setToolsOpen] = useState(false)
  const [toggleBusy, setToggleBusy] = useState(false)
  const [toolBusy, setToolBusy] = useState<Record<string, boolean>>({})
  const [resetBusy, setResetBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [reconnectBusy, setReconnectBusy] = useState(false)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
  }, [])
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

  // Card chrome on permanent outer so CONTEXT_MENUS=false keeps layout.
  return (
    <div
      data-testid="mcp-server-card"
      className={cn(
        'relative flex min-h-[180px] flex-col rounded-lg border border-border bg-surface p-4 transition-colors hover:bg-surface-subtle',
        !server.enabled && 'opacity-60',
      )}
    >
      <DeclarativeContextMenu
        kind="mcpServer"
        payload={{ serverId: server.id, onEdit, onDelete }}
        className="flex min-h-0 flex-1 flex-col"
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
            <div className="mt-3 rounded-md bg-surface-subtle p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-caption font-medium text-ink-tertiary">
                  {t('settings.mcp.sectionTools')}
                </span>
                {(server.enabledTools?.length || server.disabledTools?.length) ? (
                  <button
                    type="button"
                    onClick={async () => {
                      setActionError(null)
                      setResetBusy(true)
                      try {
                        await onResetTools()
                      } catch {
                        setActionError(t('settings.mcp.error'))
                      } finally {
                        setResetBusy(false)
                      }
                    }}
                    disabled={resetBusy}
                    className="text-caption text-accent hover:underline disabled:opacity-50"
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
                      className="flex items-center gap-2 rounded-md p-1.5 hover:bg-state-hover cursor-pointer"
                    >
                      <Switch
                        checked={enabled}
                        disabled={!!toolBusy[toolName] || resetBusy}
                        onCheckedChange={async () => {
                          setActionError(null)
                          setToolBusy((b) => ({ ...b, [toolName]: true }))
                          try {
                            await onToggleTool(toolName)
                          } catch {
                            setActionError(t('settings.mcp.error'))
                          } finally {
                            setToolBusy((b) => ({ ...b, [toolName]: false }))
                          }
                        }}
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
          <div className="flex flex-col gap-1">
            <Switch
              checked={server.enabled}
              disabled={toggleBusy}
              onCheckedChange={async (enabled) => {
                setActionError(null)
                setToggleBusy(true)
                try {
                  await onToggle(enabled)
                } catch {
                  setActionError(t('settings.mcp.error'))
                } finally {
                  setToggleBusy(false)
                }
              }}
              ariaLabel={t('settings.mcp.enableThis')}
            />
            {actionError && <span className="text-meta text-danger">{actionError}</span>}
          </div>
          <div className="flex items-center gap-1">
            {status?.status === 'disconnected' && server.enabled && (
              <ActionButton
                icon={<RefreshCw size={14} />}
                label={t('settings.mcp.reconnect')}
                onClick={() => {
                  setActionError(null)
                  setReconnectBusy(true)
                  try {
                    onReconnect()
                    // Debounce only on success; synchronous failures allow immediate retry.
                    reconnectTimerRef.current = setTimeout(() => { setReconnectBusy(false) }, 1000)
                  } catch {
                    setActionError(t('settings.mcp.error'))
                    setReconnectBusy(false)
                  }
                }}
                disabled={reconnectBusy}
              />
            )}
            <ActionButton icon={<Pencil size={14} />} label={t('settings.mcp.edit')} onClick={onEdit} />
            <ActionButton icon={<Trash2 size={14} />} label={t('settings.mcp.delete')} onClick={onDelete} danger />
          </div>
        </div>
      </DeclarativeContextMenu>
    </div>
  )
}

function PluginMcpServerCard({
  server,
  pluginName,
  pluginEnabled,
  registryActive = true,
  shadowedReason,
  status,
}: {
  server: McpServerConfig
  pluginName: string
  pluginEnabled: boolean
  /** When false, ExtensionRegistry demoted this server (shadow/capability). */
  registryActive?: boolean
  shadowedReason?: string
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
  const live = pluginEnabled && registryActive
  const statusLabel = status && live ? getStatusLabel(t, status.status) : null
  const statusTitle = status?.lastError ? `${statusLabel}: ${status.lastError}` : statusLabel || undefined
  const toolCount = live ? status?.toolCount : undefined

  return (
    <div
      className={cn(
        'relative flex min-h-[140px] flex-col rounded-lg border border-border bg-surface p-4',
        (!server.enabled || !registryActive) && 'opacity-60',
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
            {!pluginEnabled && (
              <Badge className="bg-surface-muted text-ink-tertiary">{t('settings.mcp.pluginDisabledBadge')}</Badge>
            )}
            {pluginEnabled && !registryActive && (
              <Badge
                className="bg-amber-500/15 text-amber-800 dark:text-amber-200"
                title={shadowedReason}
              >
                {t('settings.extensions.shadowedBadge', { defaultValue: 'Shadowed' })}
              </Badge>
            )}
            {live && status && (
              <span
                className="inline-flex items-center gap-1 text-caption text-ink-secondary"
                title={statusTitle}
              >
                <StatusDot status={status.status} />
                {statusLabel}
              </span>
            )}
            {live && !status && (
              <span className="text-caption text-ink-tertiary">{t('settings.mcp.statusDisconnected')}</span>
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
        {shadowedReason && !registryActive && (
          <div className="mt-2 text-caption text-amber-800/80 dark:text-amber-200/80">{shadowedReason}</div>
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
      await onSave(
        buildMcpDraft(form, {
          registryName: initial?.registryName,
          registrySourceId: initial?.registrySourceId,
          registryVersion: initial?.registryVersion,
        }),
      )
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
      <Button variant="ghost" size="sm" onClick={onCancel}>
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
                        className="flex items-center gap-2 rounded px-1 py-1 hover:bg-state-hover cursor-pointer"
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
  onConfirm: () => Promise<void>
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const handleConfirm = async () => {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
    } catch {
      setError(t('settings.mcp.error'))
    } finally {
      setBusy(false)
    }
  }
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
        {error && <p className="mt-3 text-meta text-danger">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            {t('settings.mcp.cancel')}
          </Button>
          <Button variant="danger" size="sm" onClick={() => void handleConfirm()} disabled={busy}>
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
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
          >
            <X size={15} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-meta font-medium text-accent-strong transition-colors hover:bg-state-hover"
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
      <div className="mb-2 text-caption font-medium text-ink-tertiary">{label}</div>
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
        'flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
        selected ? 'border-ink bg-surface-subtle' : 'border-border hover:bg-state-hover',
      )}
    >
      <span
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
          selected ? 'border-ink bg-ink text-surface' : 'border-border',
        )}
      >
        {selected && <Check size={11} />}
      </span>
      <div>
        <div className="text-body font-medium text-ink">{title}</div>
        <div className={cn('text-caption', selected ? 'text-ink-secondary' : 'text-ink-tertiary')}>{desc}</div>
      </div>
    </button>
  )
}
