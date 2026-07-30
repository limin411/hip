import { useEffect, useMemo, useState } from 'react'
import {
  Package,
  Trash2,
  ExternalLink,
  Eye,
  FileText,
  Download,
  RefreshCw,
  Settings2,
  Search,
  Box,
  Sparkles,
} from 'lucide-react'
import type { Components } from 'react-markdown'
import type { PluginMeta, MarketPluginEntry, MarketTab, MarketSourceState } from '@hip/protocol'
import { open } from '@tauri-apps/plugin-shell'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Pagination } from '@/components/ui/Pagination'
import { EmptyState as UiEmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { MarkdownBody } from '@/components/chat/MarkdownBody'
import { readPluginFile } from '@/ipc/plugins'
import { cn } from '@/lib/utils'
import { DeclarativeContextMenu } from '@/components/context-menu'

/** Cards per page in the market grid (3-col × 4 rows on large screens). */
export const PLUGIN_MARKET_PAGE_SIZE = 12

export function paginateItems<T>(items: T[], page: number, pageSize = PLUGIN_MARKET_PAGE_SIZE): T[] {
  const safePage = Math.max(1, page)
  const start = (safePage - 1) * pageSize
  return items.slice(start, start + pageSize)
}

/** Open a URL in the system browser (Tauri shell; falls back to window.open). */
async function openExternalUrl(url: string): Promise<void> {
  try {
    await open(url)
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

export type Translate = (key: string, options?: Record<string, unknown>) => string

export function formatComponentCounts(plugin: PluginMeta, t: Translate): string {
  return t('settings.plugins.componentCounts', {
    skills: plugin.skills.length,
    mcpServers: plugin.mcpServers.length,
    agents: plugin.agents.length,
    hooks: plugin.hookCount,
  })
}

/** Local/custom tab: plugins not attributed to any configured marketplace source. */
export function filterLocalPlugins(
  plugins: PluginMeta[],
  query: string,
  knownSourceIds?: Iterable<string>,
): PluginMeta[] {
  const known = new Set(
    knownSourceIds ?? ['grok-official', 'claude-official'],
  )
  const q = query.trim().toLowerCase()
  const custom = plugins.filter(
    (p) => !p.marketSourceId || !known.has(p.marketSourceId),
  )
  if (!q) return custom
  return custom.filter((p) => {
    const hay = [p.name, p.description, p.author, ...(p.keywords ?? [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return hay.includes(q)
  })
}

/** Map UI tab to marketplace source id (null for custom local plugins). */
export function tabToMarketSourceId(tab: MarketTab): string | null {
  if (tab === 'custom') return null
  if (tab === 'grok') return 'grok-official'
  if (tab === 'claude') return 'claude-official'
  return tab
}

export interface PluginConfigViewProps {
  plugins: PluginMeta[]
  marketEntries: MarketPluginEntry[]
  sources: MarketSourceState[]
  tab: MarketTab
  query: string
  error: string | null
  loading?: boolean
  refreshing?: boolean
  downloadingKey?: string | null
  onTabChange: (tab: MarketTab) => void
  onQueryChange: (q: string) => void
  onDelete: (plugin: PluginMeta) => void
  onToggle: (plugin: PluginMeta, enabled: boolean) => void
  onView: (plugin: PluginMeta) => void
  onDownload: (entry: MarketPluginEntry) => void
  onMarketToggle: (entry: MarketPluginEntry, enabled: boolean) => void
  onMarketUninstall: (entry: MarketPluginEntry) => void
  onOpenSources: () => void
  onRefreshCatalog: () => void
  t: Translate
}

/**
 * Plugin market: left source nav + right card grid with pagination.
 */
export function PluginConfigView({
  plugins,
  marketEntries,
  sources,
  tab,
  query,
  error,
  loading,
  refreshing,
  downloadingKey,
  onTabChange,
  onQueryChange,
  onDelete,
  onToggle,
  onView,
  onDownload,
  onMarketToggle,
  onMarketUninstall,
  onOpenSources,
  onRefreshCatalog,
  t,
}: PluginConfigViewProps) {
  const [page, setPage] = useState(1)

  const knownSourceIds = useMemo(() => sources.map((s) => s.id), [sources])
  const localFiltered = useMemo(
    () => filterLocalPlugins(plugins, query, knownSourceIds),
    [plugins, query, knownSourceIds],
  )
  const activeSourceId = tabToMarketSourceId(tab)
  const activeSource = activeSourceId
    ? sources.find((s) => s.id === activeSourceId)
    : undefined
  const sourceDisabled = Boolean(activeSource && activeSource.enabled === false)

  const listLength = tab === 'custom' ? localFiltered.length : marketEntries.length
  const totalPages = Math.max(1, Math.ceil(listLength / PLUGIN_MARKET_PAGE_SIZE))
  const safePage = Math.min(page, totalPages)

  // Reset page when market or search changes
  useEffect(() => {
    setPage(1)
  }, [tab, query])

  // Clamp if list shrinks below current page
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  const pageLocal = useMemo(
    () => paginateItems(localFiltered, safePage),
    [localFiltered, safePage],
  )
  const pageMarket = useMemo(
    () => paginateItems(marketEntries, safePage),
    [marketEntries, safePage],
  )

  const customCount = useMemo(
    () => filterLocalPlugins(plugins, '', knownSourceIds).length,
    [plugins, knownSourceIds],
  )

  const navItems = useMemo(() => {
    const items: {
      id: MarketTab
      label: string
      icon: typeof Package
      count?: number
    }[] = []
    for (const src of sources) {
      if (src.id === 'grok-official') {
        items.push({
          id: 'grok',
          label: t('settings.plugins.tabGrok'),
          icon: Sparkles,
          count: src.pluginCount,
        })
      } else if (src.id === 'claude-official') {
        items.push({
          id: 'claude',
          label: t('settings.plugins.tabClaude'),
          icon: Box,
          count: src.pluginCount,
        })
      } else {
        items.push({
          id: src.id,
          label: src.name,
          icon: Box,
          count: src.pluginCount,
        })
      }
    }
    items.push({
      id: 'custom',
      label: t('settings.plugins.tabCustom'),
      icon: Package,
      count: customCount,
    })
    return items
  }, [sources, customCount, t])

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="plugin-market">
      <div className="shrink-0 border-b border-border px-6 py-4">
        <div className="min-w-0">
          <h2 className="text-title font-semibold text-ink">{t('settings.plugins.title')}</h2>
          <p className="mt-1 text-body text-ink-secondary">{t('settings.plugins.intro')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenSources}
              data-testid="marketplace-sources-open"
            >
              <Settings2 size={14} /> {t('settings.plugins.manageSources')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={refreshing || tab === 'custom'}
              onClick={onRefreshCatalog}
              data-testid="marketplace-refresh"
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : undefined} />{' '}
              {t('settings.plugins.refreshCatalog')}
            </Button>
          </div>
        </div>
      </div>

      {/* Fill remaining height so the source nav divider runs to the pane bottom;
          cards scroll inside, pagination stays pinned. */}
      <div className="flex min-h-0 flex-1">
        {/* Left: market source nav */}
        <aside
          className="flex w-44 shrink-0 flex-col border-r border-border bg-surface-subtle/40"
          data-testid="plugin-market-sidebar"
        >
          <nav
            className="flex flex-1 flex-col gap-0.5 p-2"
            aria-label={t('settings.plugins.tabsAria')}
            data-testid="plugin-market-tabs"
          >
            {navItems.map((item) => {
              const Icon = item.icon
              const selected = tab === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  data-testid={`plugin-market-tab-${item.id}`}
                  data-mode={item.id}
                  onClick={() => onTabChange(item.id)}
                  className={cn(
                    'relative flex h-9 items-center gap-2 rounded-lg px-2.5 text-left text-meta font-medium transition-colors duration-chrome',
                    'text-ink-secondary hover:bg-state-hover hover:text-ink',
                    'before:absolute before:inset-y-1.5 before:left-0 before:w-[2px] before:rounded-full before:bg-accent before:opacity-0',
                    selected &&
                      'bg-state-hover text-ink before:opacity-100',
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

        {/* Right: search + cards + pinned pagination */}
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
                  value={query}
                  onChange={(e) => onQueryChange(e.target.value)}
                  placeholder={t('settings.plugins.searchPlaceholder')}
                  data-testid="plugin-market-search"
                />
              </div>
              {listLength > 0 && (
                <div
                  className="flex shrink-0 flex-wrap items-center gap-3"
                  data-testid="plugin-market-pagination"
                >
                  <span className="text-caption text-ink-tertiary">
                    {t('settings.plugins.pageSummary', {
                      total: listLength,
                      page: safePage,
                      pages: totalPages,
                    })}
                  </span>
                  <Pagination
                    currentPage={safePage}
                    totalPages={totalPages}
                    onChange={setPage}
                    previousLabel={t('settings.plugins.previousPage')}
                    nextLabel={t('settings.plugins.nextPage')}
                  />
                </div>
              )}
            </div>

            {error && (
              <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-meta text-danger">
                {error}
              </div>
            )}

            {sourceDisabled && (
              <div className="rounded-md border border-border bg-surface-subtle px-3 py-2 text-meta text-ink-secondary">
                {t('settings.plugins.sourceDisabledBanner')}
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {loading ? (
              <div className="space-y-3" data-testid="plugin-market-loading">
                <p className="text-body text-ink-tertiary">{t('settings.plugins.loading')}</p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  <Skeleton className="h-28 rounded-xl" />
                  <Skeleton className="h-28 rounded-xl" />
                  <Skeleton className="h-28 rounded-xl" />
                </div>
              </div>
            ) : tab === 'custom' ? (
              localFiltered.length === 0 ? (
                <UiEmptyState
                  icon={Package}
                  tier="professional"
                  title={
                    query.trim()
                      ? t('settings.plugins.noSearchResults')
                      : t('settings.plugins.empty')
                  }
                  description={
                    query.trim()
                      ? t('settings.plugins.noSearchResultsHint')
                      : t('settings.plugins.emptyHint')
                  }
                  className="border border-dashed border-border bg-surface-subtle"
                  data-testid={query.trim() ? 'plugin-market-no-results' : 'plugin-market-empty'}
                />
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {pageLocal.map((plugin) => (
                    <PluginCard
                      key={plugin.id}
                      plugin={plugin}
                      onDelete={() => onDelete(plugin)}
                      onToggle={(on) => onToggle(plugin, on)}
                      onView={() => onView(plugin)}
                      t={t}
                    />
                  ))}
                </div>
              )
            ) : marketEntries.length === 0 ? (
              <UiEmptyState
                icon={Package}
                tier="professional"
                title={
                  query.trim()
                    ? t('settings.plugins.noSearchResults')
                    : t('settings.plugins.marketEmpty')
                }
                description={
                  query.trim()
                    ? t('settings.plugins.noSearchResultsHint')
                    : t('settings.plugins.marketEmptyHint')
                }
                className="border border-dashed border-border bg-surface-subtle"
                data-testid={query.trim() ? 'plugin-market-no-results' : 'plugin-market-empty'}
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {pageMarket.map((entry) => (
                  <MarketPluginCard
                    key={entry.key}
                    entry={entry}
                    downloading={downloadingKey === entry.key}
                    onDownload={() => onDownload(entry)}
                    onToggle={(on) => onMarketToggle(entry, on)}
                    onUninstall={() => onMarketUninstall(entry)}
                    t={t}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Bottom bar mirrors page info so pagination stays obvious after scrolling cards */}
          {listLength > 0 && (
            <div
              className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-surface px-5 py-2.5"
              data-testid="plugin-market-pagination-footer"
            >
              <span className="text-caption text-ink-tertiary">
                {t('settings.plugins.pageSummary', {
                  total: listLength,
                  page: safePage,
                  pages: totalPages,
                })}
              </span>
              <Pagination
                currentPage={safePage}
                totalPages={totalPages}
                onChange={setPage}
                previousLabel={t('settings.plugins.previousPage')}
                nextLabel={t('settings.plugins.nextPage')}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function downloadBadge(
  entry: MarketPluginEntry,
  t: Translate,
): { label: string; className: string } {
  if (entry.downloadState === 'downloading') {
    return {
      label: t('settings.plugins.stateDownloading'),
      className: 'bg-accent-subtle text-accent-strong',
    }
  }
  if (entry.downloadState === 'review_failed') {
    return {
      label: t('settings.plugins.stateReviewFailed'),
      className: 'bg-danger/10 text-danger',
    }
  }
  if (entry.downloadState === 'downloaded') {
    if (entry.enabled) {
      return {
        label: t('settings.plugins.stateDownloadedEnabled'),
        className: 'bg-success/10 text-success',
      }
    }
    return {
      label: t('settings.plugins.stateDownloadedDisabled'),
      className: 'bg-accent-subtle text-accent-strong',
    }
  }
  return {
    label: t('settings.plugins.stateNotDownloaded'),
    className: 'bg-surface-muted text-ink-tertiary',
  }
}

/** Shared card shell so Grok / Claude / custom grids keep equal cell heights. */
const marketCardShell =
  'flex h-full min-h-[13.5rem] flex-col rounded-lg border border-border bg-surface p-4'

function MarketPluginCard({
  entry,
  downloading,
  onDownload,
  onToggle,
  onUninstall,
  t,
}: {
  entry: MarketPluginEntry
  downloading: boolean
  onDownload: () => void
  onToggle: (on: boolean) => void
  onUninstall: () => void
  t: Translate
}) {
  const badge = downloadBadge(entry, t)
  const downloaded = entry.downloadState === 'downloaded'
  const canDownload =
    !downloaded && entry.install != null && entry.downloadState !== 'downloading' && !downloading

  const tags = [
    entry.category,
    ...(entry.keywords?.slice(0, 3) ?? []),
  ].filter((x): x is string => Boolean(x))

  const cardBody = (
    <>
      {/* Header: fixed 2-line title block + switch slot */}
      <div className="flex min-h-[2.75rem] shrink-0 items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-subtle text-accent-strong">
          <Package size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-body font-medium text-ink" title={entry.name}>
              {entry.name}
            </span>
            <span
              className={`max-w-[7.5rem] shrink-0 truncate rounded px-1.5 py-0.5 text-caption ${badge.className}`}
              title={badge.label}
            >
              {badge.label}
            </span>
          </div>
          <div className="mt-0.5 h-4 truncate text-caption text-ink-tertiary">
            {entry.author ?? '\u00a0'}
          </div>
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center">
          {downloaded ? (
            <Switch
              checked={entry.enabled}
              onCheckedChange={onToggle}
              ariaLabel={t('settings.plugins.enableThis')}
              data-testid={`market-plugin-enable-${entry.key}`}
            />
          ) : null}
        </div>
      </div>

      {/* Description always reserves 2 lines */}
      <div
        className="mt-3 line-clamp-2 min-h-[2.5rem] text-body text-ink-secondary"
        title={entry.description}
      >
        {entry.description?.trim() || '\u00a0'}
      </div>

      {/* Tags / homepage: single reserved row */}
      <div className="mt-2 flex min-h-[1.375rem] flex-wrap items-center gap-1.5 overflow-hidden">
        {tags.map((tag) => (
          <span
            key={tag}
            className="max-w-[8rem] truncate rounded bg-surface-subtle px-1.5 py-0.5 text-caption text-ink-tertiary"
          >
            {tag}
          </span>
        ))}
        {entry.homepage ? (
          <a
            href={entry.homepage}
            className="inline-flex items-center gap-0.5 text-caption text-accent-strong hover:underline"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              void openExternalUrl(entry.homepage!)
            }}
          >
            <ExternalLink size={12} />
            {t('settings.plugins.source')}
          </a>
        ) : null}
      </div>

      {entry.modelReview?.status === 'rewritten' ? (
        <div className="mt-1 truncate text-caption text-ink-tertiary" title={t('settings.plugins.modelRewritten', {
          model: `${entry.modelReview.defaultModel.providerID}/${entry.modelReview.defaultModel.modelID}`,
        })}>
          {t('settings.plugins.modelRewritten', {
            model: `${entry.modelReview.defaultModel.providerID}/${entry.modelReview.defaultModel.modelID}`,
          })}
        </div>
      ) : (
        <div className="mt-1 h-4" aria-hidden />
      )}

      <div className="mt-auto flex justify-end gap-2 pt-3">
        {downloaded ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onUninstall}
            data-testid="market-plugin-uninstall"
          >
            <Trash2 size={14} /> {t('settings.plugins.uninstall')}
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={!canDownload}
            onClick={onDownload}
            data-testid="market-plugin-download"
            title={entry.installBlockedReason}
          >
            <Download size={14} />{' '}
            {downloading ? t('settings.plugins.downloading') : t('settings.plugins.download')}
          </Button>
        )}
      </div>
    </>
  )

  // Undownloaded cards: no context menu (download is the only primary action).
  if (!downloaded) {
    return (
      <div
        data-testid="market-plugin-card"
        data-plugin-key={entry.key}
        className={marketCardShell}
      >
        {cardBody}
      </div>
    )
  }

  return (
    <div
      data-testid="market-plugin-card"
      data-plugin-key={entry.key}
      className={marketCardShell}
    >
      <DeclarativeContextMenu
        kind="plugin"
        payload={{
          pluginId: entry.key,
          onUninstall,
        }}
        className="flex h-full min-h-0 flex-col"
      >
        {cardBody}
      </DeclarativeContextMenu>
    </div>
  )
}

function PluginCard({
  plugin,
  onDelete,
  onToggle,
  onView,
  t,
}: {
  plugin: PluginMeta
  onDelete: () => void
  onToggle: (on: boolean) => void
  onView: () => void
  t: Translate
}) {
  return (
    <div
      data-testid="plugin-card"
      data-plugin-id={plugin.id}
      className={marketCardShell}
    >
      <DeclarativeContextMenu
        kind="plugin"
        payload={{
          pluginId: plugin.id,
          onUninstall: onDelete,
          onView,
        }}
        className="flex h-full min-h-0 flex-col"
      >
        <div className="flex min-h-[2.75rem] shrink-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-subtle text-accent-strong">
            <Package size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-body font-medium text-ink" title={plugin.name}>
                {plugin.name}
              </span>
              <span className="shrink-0 text-caption text-ink-tertiary">{plugin.version}</span>
              <span className="shrink-0 rounded bg-surface-muted px-1.5 py-0.5 text-caption text-ink-tertiary">
                {t('settings.plugins.localBadge')}
              </span>
            </div>
            <div className="mt-0.5 h-4 truncate text-caption text-ink-tertiary">
              {plugin.author ?? '\u00a0'}
            </div>
          </div>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center">
            <Switch
              checked={plugin.enabled}
              onCheckedChange={onToggle}
              ariaLabel={t('settings.plugins.enableThis')}
              data-testid={`plugin-enable-${plugin.id}`}
            />
          </div>
        </div>
        <div
          className="mt-3 line-clamp-2 min-h-[2.5rem] text-body text-ink-secondary"
          title={plugin.description}
        >
          {plugin.description?.trim() || '\u00a0'}
        </div>
        <div className="mt-2 h-4 truncate text-caption text-ink-tertiary">
          {formatComponentCounts(plugin, t)}
        </div>
        <div className="mt-2 flex min-h-[1.375rem] flex-wrap items-center gap-1.5 overflow-hidden">
          {plugin.license ? (
            <span className="rounded bg-surface-subtle px-1.5 py-0.5 text-caption text-ink-tertiary">
              {plugin.license}
            </span>
          ) : null}
          {plugin.keywords?.slice(0, 3).map((kw) => (
            <span
              key={kw}
              className="max-w-[8rem] truncate rounded bg-surface-subtle px-1.5 py-0.5 text-caption text-ink-tertiary"
            >
              {kw}
            </span>
          ))}
          {plugin.sourceUrl ? (
            <a
              href={plugin.sourceUrl}
              data-testid="plugin-source-link"
              className="inline-flex items-center gap-0.5 text-caption text-accent-strong hover:underline"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                void openExternalUrl(plugin.sourceUrl!)
              }}
            >
              <ExternalLink size={12} />
              {t('settings.plugins.source')}
            </a>
          ) : null}
        </div>
        <div className="mt-auto flex justify-end gap-2 pt-3">
          <Button variant="outline" size="sm" onClick={onView} data-testid="plugin-view">
            <Eye size={14} /> {t('settings.plugins.view')}
          </Button>
          <Button variant="outline" size="sm" onClick={onDelete} data-testid="plugin-uninstall">
            <Trash2 size={14} /> {t('settings.plugins.uninstall')}
          </Button>
        </div>
      </DeclarativeContextMenu>
    </div>
  )
}

export function PluginViewModal({
  plugin,
  onClose,
  t,
  mode = 'inline',
}: {
  plugin: PluginMeta
  onClose: () => void
  t: Translate
  /** `inline` = in-shell Settings L2 (default). `modal` = legacy portaled Task dialog. */
  mode?: 'modal' | 'inline'
}) {
  const [body, setBody] = useState<string | null>(null)
  const [docError, setDocError] = useState(false)
  const title = t('settings.plugins.viewTitle', { name: plugin.name })

  useEffect(() => {
    let live = true
    setBody(null)
    setDocError(false)
    if (!plugin.hasPluginMd) {
      setBody('')
      return
    }
    readPluginFile(plugin.id, 'PLUGIN.md')
      .then((b) => {
        if (live) setBody(b)
      })
      .catch(() => {
        if (live) setDocError(true)
      })
    return () => {
      live = false
    }
  }, [plugin.id, plugin.hasPluginMd])

  const markdownComponents: Components = {
    code({ className, children, ...props }) {
      const isBlock = className?.startsWith('language-')
      return (
        <code className={isBlock ? className : undefined} {...props}>
          {children}
        </code>
      )
    },
  }

  const displayBody = body
    ? body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim()
    : null

  const content = (
    <div className="space-y-4 p-6" data-testid="plugin-view-modal">
      <div className="flex flex-wrap items-center gap-2 text-meta text-ink-tertiary">
        <span>{plugin.version}</span>
        {plugin.author && <span>· {plugin.author}</span>}
        {plugin.license && <span>· {plugin.license}</span>}
        <span
          className={
            plugin.enabled
              ? 'rounded bg-success/10 px-1.5 py-0.5 text-success'
              : 'rounded bg-surface-muted px-1.5 py-0.5'
          }
        >
          {plugin.enabled ? t('settings.plugins.statusEnabled') : t('settings.plugins.statusDisabled')}
        </span>
      </div>

      {plugin.description && (
        <p className="text-body text-ink-secondary">{plugin.description}</p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ComponentList
          title={t('settings.plugins.skillsSection')}
          items={plugin.skills}
          empty={t('settings.plugins.none')}
        />
        <ComponentList
          title={t('settings.plugins.mcpSection')}
          items={plugin.mcpServers.map((s) => s.name || s.id)}
          empty={t('settings.plugins.none')}
        />
        <ComponentList
          title={t('settings.plugins.agentsSection')}
          items={plugin.agents}
          empty={t('settings.plugins.none')}
        />
        <ComponentList
          title={t('settings.plugins.hooksSection')}
          items={
            plugin.hookEvents.length > 0
              ? plugin.hookEvents
              : plugin.hookCount > 0
                ? [t('settings.plugins.hookCountOnly', { count: plugin.hookCount })]
                : []
          }
          empty={t('settings.plugins.none')}
        />
      </div>

      {plugin.dir && (
        <div className="break-all text-caption text-ink-tertiary">
          {t('settings.plugins.pathLabel')}: {plugin.dir}
        </div>
      )}

      {plugin.hasPluginMd && (
        <div className="border-t border-border pt-4">
          <h3 className="mb-2 text-meta font-medium text-ink-secondary">
            {t('settings.plugins.docSection')}
          </h3>
          {docError ? (
            <div className="flex items-center gap-2 text-body text-danger">
              <FileText size={16} /> {t('settings.plugins.loadError')}
            </div>
          ) : displayBody === null ? (
            <div className="text-body text-ink-tertiary">…</div>
          ) : displayBody === '' ? (
            <div className="text-meta text-ink-tertiary">{t('settings.plugins.noDocBody')}</div>
          ) : (
            <MarkdownBody content={displayBody} components={markdownComponents} />
          )}
        </div>
      )}
    </div>
  )

  if (mode === 'inline') {
    return (
      <div className="flex h-full min-h-0 flex-col" data-testid="settings-plugin-view">
        <div className="flex h-12 shrink-0 items-center border-b border-border px-5">
          <h2 className="text-title font-semibold tracking-tight text-ink">{title}</h2>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{content}</div>
      </div>
    )
  }

  return (
    <Modal
      open
      variant="task"
      nested
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
      title={title}
      resizable
      storageKey="plugin-view"
      className="max-w-2xl"
    >
      {content}
    </Modal>
  )
}

function ComponentList({
  title,
  items,
  empty,
}: {
  title: string
  items: string[]
  empty: string
}) {
  return (
    <div className="rounded-md border border-border bg-surface-subtle p-3">
      <div className="text-meta font-medium text-ink-secondary">{title}</div>
      {items.length === 0 ? (
        <div className="mt-1 text-caption text-ink-tertiary">{empty}</div>
      ) : (
        <ul className="mt-1 max-h-28 list-inside list-disc overflow-y-auto text-caption text-ink">
          {items.map((item) => (
            <li key={item} className="truncate">
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
