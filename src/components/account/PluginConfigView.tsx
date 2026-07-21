import { useEffect, useMemo, useState } from 'react'
import { Package, Trash2, ExternalLink, Eye, FileText, Download, RefreshCw, Settings2, Search } from 'lucide-react'
import type { Components } from 'react-markdown'
import type { PluginMeta, MarketPluginEntry, MarketTab, MarketSourceState } from '@hip/protocol'
import { open } from '@tauri-apps/plugin-shell'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { MarkdownBody } from '@/components/chat/MarkdownBody'
import { readPluginFile } from '@/ipc/plugins'

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

export function filterLocalPlugins(plugins: PluginMeta[], query: string): PluginMeta[] {
  const q = query.trim().toLowerCase()
  // Custom = not from official markets
  const custom = plugins.filter(
    (p) => p.marketSourceId !== 'grok-official' && p.marketSourceId !== 'claude-official',
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
 * Plugin market: Grok / Claude remote catalogs + custom local plugins.
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
  const localFiltered = useMemo(() => filterLocalPlugins(plugins, query), [plugins, query])
  const sourceDisabled =
    (tab === 'grok' && sources.find((s) => s.id === 'grok-official')?.enabled === false) ||
    (tab === 'claude' && sources.find((s) => s.id === 'claude-official')?.enabled === false)

  return (
    <div className="p-6" data-testid="plugin-market">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-title font-semibold text-ink">{t('settings.plugins.title')}</h2>
          <p className="mt-1 text-body text-ink-secondary">{t('settings.plugins.intro')}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
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

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
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
        <SegmentedControl
          data-testid="plugin-market-tabs"
          aria-label={t('settings.plugins.tabsAria')}
          value={tab}
          onChange={onTabChange}
          options={[
            { value: 'grok', label: t('settings.plugins.tabGrok') },
            { value: 'claude', label: t('settings.plugins.tabClaude') },
            { value: 'custom', label: t('settings.plugins.tabCustom') },
          ]}
        />
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-meta text-danger">
          {error}
        </div>
      )}

      {sourceDisabled && (
        <div className="mt-4 rounded-md border border-border bg-surface-subtle px-3 py-2 text-meta text-ink-secondary">
          {t('settings.plugins.sourceDisabledBanner')}
        </div>
      )}

      {loading ? (
        <div className="mt-5 text-body text-ink-tertiary">{t('settings.plugins.loading')}</div>
      ) : tab === 'custom' ? (
        localFiltered.length === 0 ? (
          <EmptyState
            title={
              query.trim()
                ? t('settings.plugins.noSearchResults')
                : t('settings.plugins.empty')
            }
            hint={
              query.trim()
                ? t('settings.plugins.noSearchResultsHint')
                : t('settings.plugins.emptyHint')
            }
            testId={query.trim() ? 'plugin-market-no-results' : 'plugin-market-empty'}
          />
        ) : (
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {localFiltered.map((plugin) => (
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
        <EmptyState
          title={
            query.trim()
              ? t('settings.plugins.noSearchResults')
              : t('settings.plugins.marketEmpty')
          }
          hint={
            query.trim()
              ? t('settings.plugins.noSearchResultsHint')
              : t('settings.plugins.marketEmptyHint')
          }
          testId={query.trim() ? 'plugin-market-no-results' : 'plugin-market-empty'}
        />
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {marketEntries.map((entry) => (
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
  )
}

function EmptyState({
  title,
  hint,
  testId,
}: {
  title: string
  hint: string
  testId: string
}) {
  return (
    <div
      className="mt-5 rounded-lg border border-dashed border-border bg-surface-subtle px-4 py-8 text-center"
      data-testid={testId}
    >
      <Package size={22} className="mx-auto text-ink-tertiary" />
      <div className="mt-2 text-body text-ink-secondary">{title}</div>
      <div className="mt-1 text-meta text-ink-tertiary">{hint}</div>
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

  return (
    <div
      data-testid="market-plugin-card"
      data-plugin-key={entry.key}
      className="flex flex-col rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-subtle text-accent-strong">
          <Package size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-body font-medium text-ink">{entry.name}</span>
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-caption ${badge.className}`}>
              {badge.label}
            </span>
          </div>
          {entry.author && (
            <div className="truncate text-caption text-ink-tertiary">{entry.author}</div>
          )}
        </div>
        {downloaded && (
          <Switch
            checked={entry.enabled}
            onCheckedChange={onToggle}
            ariaLabel={t('settings.plugins.enableThis')}
            data-testid={`market-plugin-enable-${entry.key}`}
          />
        )}
      </div>
      {entry.description && (
        <div className="mt-3 line-clamp-2 text-body text-ink-secondary">{entry.description}</div>
      )}
      {(entry.keywords?.length || entry.homepage || entry.category) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {entry.category && (
            <span className="rounded bg-surface-subtle px-1.5 py-0.5 text-caption text-ink-tertiary">
              {entry.category}
            </span>
          )}
          {entry.keywords?.slice(0, 4).map((kw) => (
            <span
              key={kw}
              className="rounded bg-surface-subtle px-1.5 py-0.5 text-caption text-ink-tertiary"
            >
              {kw}
            </span>
          ))}
          {entry.homepage && (
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
          )}
        </div>
      )}
      {entry.modelReview?.status === 'rewritten' && (
        <div className="mt-2 text-caption text-ink-tertiary">
          {t('settings.plugins.modelRewritten', {
            model: `${entry.modelReview.defaultModel.providerID}/${entry.modelReview.defaultModel.modelID}`,
          })}
        </div>
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
      className="flex flex-col rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-subtle text-accent-strong">
          <Package size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-body font-medium text-ink">{plugin.name}</span>
            <span className="shrink-0 text-caption text-ink-tertiary">{plugin.version}</span>
            <span className="shrink-0 rounded bg-surface-muted px-1.5 py-0.5 text-caption text-ink-tertiary">
              {t('settings.plugins.localBadge')}
            </span>
          </div>
          {plugin.author && (
            <div className="truncate text-caption text-ink-tertiary">{plugin.author}</div>
          )}
        </div>
        <Switch
          checked={plugin.enabled}
          onCheckedChange={onToggle}
          ariaLabel={t('settings.plugins.enableThis')}
          data-testid={`plugin-enable-${plugin.id}`}
        />
      </div>
      {plugin.description && (
        <div className="mt-3 line-clamp-2 text-body text-ink-secondary">{plugin.description}</div>
      )}
      <div className="mt-3 text-caption text-ink-tertiary">{formatComponentCounts(plugin, t)}</div>
      {(plugin.keywords?.length || plugin.sourceUrl || plugin.license) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {plugin.license && (
            <span className="rounded bg-surface-subtle px-1.5 py-0.5 text-caption text-ink-tertiary">
              {plugin.license}
            </span>
          )}
          {plugin.keywords?.slice(0, 4).map((kw) => (
            <span
              key={kw}
              className="rounded bg-surface-subtle px-1.5 py-0.5 text-caption text-ink-tertiary"
            >
              {kw}
            </span>
          ))}
          {plugin.sourceUrl && (
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
          )}
        </div>
      )}
      <div className="mt-auto flex justify-end gap-2 pt-3">
        <Button variant="outline" size="sm" onClick={onView} data-testid="plugin-view">
          <Eye size={14} /> {t('settings.plugins.view')}
        </Button>
        <Button variant="outline" size="sm" onClick={onDelete} data-testid="plugin-uninstall">
          <Trash2 size={14} /> {t('settings.plugins.uninstall')}
        </Button>
      </div>
    </div>
  )
}

export function PluginViewModal({
  plugin,
  onClose,
  t,
}: {
  plugin: PluginMeta
  onClose: () => void
  t: Translate
}) {
  const [body, setBody] = useState<string | null>(null)
  const [docError, setDocError] = useState(false)

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

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
      title={t('settings.plugins.viewTitle', { name: plugin.name })}
      resizable
      storageKey="plugin-view"
      className="max-w-2xl"
    >
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
