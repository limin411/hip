import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MarketPluginEntry, PluginMeta } from '@hip/protocol'
import { usePluginsStore } from '@/store/pluginsStore'
import { useMarketplaceStore, tabToSourceId } from '@/store/marketplaceStore'
import { useExtensionStore } from '@/store/extensionStore'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { PluginConfigView, PluginViewModal, type Translate } from './PluginConfigView'
import { MarketplaceSourceModal } from './MarketplaceSourceModal'
import { ExtensionConflictsBanner } from './ExtensionConflictsBanner'
import { PreflightEnableModal } from './PreflightEnableModal'
import type { ExtensionPreflightSummary } from '@/store/extensionStore'
import { SETTINGS_SHELL_PAGE, useUiStore } from '@/store/uiStore'

/**
 * Settings → Plugin Market.
 * Seeded Grok / Claude catalogs + user-added GitHub market sources + local custom plugins.
 */
export function PluginConfig() {
  const { t } = useTranslation()
  const { plugins, loaded: pluginsLoaded, load: loadPlugins, remove, toggle } = usePluginsStore()
  const market = useMarketplaceStore()
  const preflightEnable = useExtensionStore((s) => s.preflightEnable)
  const inspect = useExtensionStore((s) => s.inspect)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<PluginMeta | null>(null)
  const settingsShellRoute = useUiStore((s) => s.settingsShellRoute)
  const setSettingsShellRoute = useUiStore((s) => s.setSettingsShellRoute)
  const [sourcesOpen, setSourcesOpen] = useState(false)

  const pluginViewId =
    settingsShellRoute.type === 'plugin-view' ? settingsShellRoute.pluginId : null
  const viewing = useMemo(() => {
    if (!pluginViewId) return null
    return plugins.find((p) => p.id === pluginViewId) ?? null
  }, [pluginViewId, plugins])
  const [preflightNote, setPreflightNote] = useState<string | null>(null)
  const [pendingEnable, setPendingEnable] = useState<{
    plugin: PluginMeta
    summary: ExtensionPreflightSummary
  } | null>(null)
  const [enableBusy, setEnableBusy] = useState(false)

  useEffect(() => {
    if (!pluginsLoaded) void loadPlugins()
  }, [pluginsLoaded, loadPlugins])

  const marketLoad = useMarketplaceStore((s) => s.load)
  const marketRefresh = useMarketplaceStore((s) => s.refresh)
  const marketLoaded = useMarketplaceStore((s) => s.loaded)
  const marketTab = useMarketplaceStore((s) => s.tab)
  const marketSources = useMarketplaceStore((s) => s.sources)
  const marketRefreshing = useMarketplaceStore((s) => s.refreshing)
  const marketAdding = useMarketplaceStore((s) => s.adding)
  const marketEntriesRaw = useMarketplaceStore((s) => s.entries)
  const marketQuery = useMarketplaceStore((s) => s.query)

  useEffect(() => {
    if (!marketLoaded) void marketLoad()
  }, [marketLoaded, marketLoad])

  // Drop L2 route if the viewed plugin was uninstalled (only after plugins loaded).
  useEffect(() => {
    if (pluginViewId && pluginsLoaded && !viewing) {
      setSettingsShellRoute(SETTINGS_SHELL_PAGE)
    }
  }, [pluginViewId, viewing, pluginsLoaded, setSettingsShellRoute])

  // Auto-refresh each source at most once per mount when no catalog yet.
  const autoRefreshAttempted = useRef<Set<string>>(new Set())
  useEffect(() => {
    const sourceId = tabToSourceId(marketTab)
    if (!sourceId) return
    const src = marketSources.find((s) => s.id === sourceId)
    if (!src?.enabled || src.lastFetchedAt || marketRefreshing) return
    if (autoRefreshAttempted.current.has(sourceId)) return
    autoRefreshAttempted.current.add(sourceId)
    void marketRefresh(sourceId)
  }, [marketTab, marketSources, marketRefreshing, marketRefresh])

  const marketEntries = useMemo(
    () => market.filteredEntries(),
    // filteredEntries reads store; depend on inputs
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [marketEntriesRaw, marketTab, marketQuery],
  )

  const combinedError = error ?? market.error ?? preflightNote

  const resolveLocal = (entry: MarketPluginEntry): PluginMeta | undefined => {
    if (entry.localPluginId) {
      return plugins.find((p) => p.id === entry.localPluginId)
    }
    return undefined
  }

  const applyEnable = async (plugin: PluginMeta, enabled: boolean) => {
    await toggle(plugin.id, enabled)
    await inspect(undefined, { force: true })
  }

  const enableWithPreflight = async (plugin: PluginMeta, enabled: boolean) => {
    setError(null)
    setPreflightNote(null)
    setPendingEnable(null)
    if (enabled) {
      const pf = await preflightEnable({ pluginId: plugin.id, pluginDir: plugin.dir })
      if (pf?.hasConflicts) {
        setPendingEnable({ plugin, summary: pf })
        return
      }
    }
    await applyEnable(plugin, enabled)
  }

  const confirmPendingEnable = async () => {
    if (!pendingEnable) return
    setEnableBusy(true)
    try {
      await applyEnable(pendingEnable.plugin, true)
      setPreflightNote(
        t('settings.extensions.preflightEnabledWithConflicts', {
          defaultValue:
            'Plugin enabled with conflicts resolved by precedence (project/user win). Check the bottom-right notification for details.',
        }),
      )
      setPendingEnable(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.plugins.toggleError'))
    } finally {
      setEnableBusy(false)
    }
  }

  // In-shell L2: plugin detail replaces list body (no second Modal).
  if (viewing) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PluginViewModal
          plugin={viewing}
          mode="inline"
          onClose={() => setSettingsShellRoute(SETTINGS_SHELL_PAGE)}
          t={t as Translate}
        />
        {deleting && (
          <Modal
            open
            variant="confirm"
            onOpenChange={(o) => {
              if (!o) setDeleting(null)
            }}
            title={t('settings.plugins.deleteConfirmTitle', { name: deleting.name })}
          >
            <div className="p-5">
              <p className="text-body text-ink-secondary">{t('settings.plugins.deleteConfirmBody')}</p>
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setDeleting(null)}>
                  {t('settings.plugins.cancel')}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    remove(deleting.id)
                      .then(async () => {
                        if (viewing?.id === deleting.id) {
                          setSettingsShellRoute(SETTINGS_SHELL_PAGE)
                        }
                        setDeleting(null)
                        await market.load()
                      })
                      .catch((err: Error) => {
                        setDeleting(null)
                        setError(err.message ?? t('settings.plugins.deleteError'))
                      })
                  }}
                >
                  {t('settings.plugins.uninstall')}
                </Button>
              </div>
            </div>
          </Modal>
        )}
        <PreflightEnableModal
          open={pendingEnable != null}
          summary={pendingEnable?.summary ?? null}
          pluginName={pendingEnable?.plugin.name}
          busy={enableBusy}
          onCancel={() => {
            if (!enableBusy) setPendingEnable(null)
          }}
          onConfirm={() => {
            void confirmPendingEnable()
          }}
        />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Banner returns null when idle — no wrapper (avoids empty top strip). */}
      <ExtensionConflictsBanner className="mx-6 mt-4 shrink-0" />
      <div className="min-h-0 flex-1">
        <PluginConfigView
          plugins={plugins}
          marketEntries={marketEntries}
          sources={market.sources}
          tab={market.tab}
          query={market.query}
          error={combinedError}
          loading={market.loading && !market.loaded}
          refreshing={market.refreshing}
          downloadingKey={market.downloadingKey}
          onTabChange={market.setTab}
          onQueryChange={market.setQuery}
          onDelete={(plugin) => {
            setError(null)
            setDeleting(plugin)
          }}
          onToggle={(plugin, enabled) => {
            void enableWithPreflight(plugin, enabled).catch((err: Error) => {
              setError(err.message ?? t('settings.plugins.toggleError'))
            })
          }}
          onView={(plugin) => {
            setError(null)
            setSettingsShellRoute({ type: 'plugin-view', pluginId: plugin.id })
          }}
          onDownload={(entry) => {
            setError(null)
            void market.download(entry).then(
              async () => {
                await loadPlugins()
              },
              (err: Error) => {
                setError(err.message ?? t('settings.plugins.installError'))
              },
            )
          }}
          onMarketToggle={(entry, enabled) => {
            const local = resolveLocal(entry)
            if (!local) return
            void enableWithPreflight(local, enabled)
              .then(() => market.load())
              .catch((err: Error) => {
                setError(err.message ?? t('settings.plugins.toggleError'))
              })
          }}
          onMarketUninstall={(entry) => {
            const local = resolveLocal(entry)
            if (!local) return
            setError(null)
            setDeleting(local)
          }}
          onOpenSources={() => setSourcesOpen(true)}
          onRefreshCatalog={() => {
            const sourceId = tabToSourceId(market.tab) ?? undefined
            void market.refresh(sourceId)
          }}
          t={t as Translate}
        />
      </div>

      <PreflightEnableModal
        open={pendingEnable != null}
        summary={pendingEnable?.summary ?? null}
        pluginName={pendingEnable?.plugin.name}
        busy={enableBusy}
        onCancel={() => {
          if (!enableBusy) setPendingEnable(null)
        }}
        onConfirm={() => {
          void confirmPendingEnable()
        }}
      />

      <MarketplaceSourceModal
        open={sourcesOpen}
        sources={market.sources}
        refreshing={market.refreshing}
        adding={marketAdding}
        onClose={() => setSourcesOpen(false)}
        onToggle={(id, enabled) => {
          void market.setSourceEnabled(id, enabled).catch((err: Error) => {
            setError(err.message)
          })
        }}
        onRefresh={(id) => {
          void market.refresh(id)
        }}
        onAdd={async (gitUrl) => {
          setError(null)
          await market.addSource(gitUrl)
        }}
        onRemove={async (id) => {
          setError(null)
          await market.removeSource(id)
        }}
        t={t as Translate}
      />

      {deleting && (
        <Modal
          open
          variant="confirm"
          onOpenChange={(o) => {
            if (!o) setDeleting(null)
          }}
          title={t('settings.plugins.deleteConfirmTitle', { name: deleting.name })}
        >
          <div className="p-5">
            <p className="text-body text-ink-secondary">{t('settings.plugins.deleteConfirmBody')}</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setDeleting(null)}>
                {t('settings.plugins.cancel')}
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  remove(deleting.id)
                    .then(async () => {
                      setDeleting(null)
                      await market.load()
                    })
                    .catch((err: Error) => {
                      setDeleting(null)
                      setError(err.message ?? t('settings.plugins.deleteError'))
                    })
                }}
              >
                {t('settings.plugins.uninstall')}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
