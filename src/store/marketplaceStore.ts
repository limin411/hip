import { create } from 'zustand'
import type {
  MarketPluginEntry,
  MarketSourceState,
  MarketTab,
  MarketInstallSpec,
  PluginModelReviewSummary,
} from '@hip/protocol'
import {
  listMarketplacePlugins,
  listMarketplaceSources,
  refreshMarketplaceCatalog,
  setMarketplaceSourceEnabled,
} from '@/ipc/marketplace'
import { wsClient } from '@/ipc/ws-client'
import { useDomainStore } from '@/domain/sessionStore'

interface MarketplaceStore {
  sources: MarketSourceState[]
  entries: MarketPluginEntry[]
  loaded: boolean
  loading: boolean
  refreshing: boolean
  error: string | null
  tab: MarketTab
  query: string
  /** key currently downloading */
  downloadingKey: string | null
  lastModelReview: PluginModelReviewSummary | null

  setTab: (tab: MarketTab) => void
  setQuery: (q: string) => void
  load: () => Promise<void>
  refresh: (sourceId?: string) => Promise<void>
  setSourceEnabled: (sourceId: string, enabled: boolean) => Promise<void>
  download: (entry: MarketPluginEntry) => Promise<void>
  filteredEntries: () => MarketPluginEntry[]
}

function filterEntries(entries: MarketPluginEntry[], tab: MarketTab, query: string): MarketPluginEntry[] {
  const q = query.trim().toLowerCase()
  let list = entries
  if (tab === 'grok') {
    list = entries.filter((e) => e.marketKind === 'grok')
  } else if (tab === 'claude') {
    list = entries.filter((e) => e.marketKind === 'claude')
  } else {
    // custom tab uses local plugins store — remote entries not used
    list = []
  }
  if (!q) return list
  return list.filter((e) => {
    const hay = [e.name, e.description, e.author, e.category, ...(e.keywords ?? [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return hay.includes(q)
  })
}

function waitForPluginInstall(
  timeoutMs = 180_000,
): Promise<{ ok: boolean; pluginId?: string; error?: string; modelReview?: PluginModelReviewSummary }> {
  return new Promise((resolve) => {
    const start = Date.now()
    const tick = () => {
      const st = useDomainStore.getState().pluginInstall
      if (st?.result) {
        resolve({
          ok: st.result.ok,
          pluginId: st.pluginId,
          error: st.result.error,
          modelReview: st.modelReview,
        })
        return
      }
      if (Date.now() - start > timeoutMs) {
        resolve({ ok: false, error: 'Install timed out' })
        return
      }
      setTimeout(tick, 200)
    }
    tick()
  })
}

export const useMarketplaceStore = create<MarketplaceStore>((set, get) => ({
  sources: [],
  entries: [],
  loaded: false,
  loading: false,
  refreshing: false,
  error: null,
  tab: 'custom',
  query: '',
  downloadingKey: null,
  lastModelReview: null,

  setTab: (tab) => set({ tab }),
  setQuery: (query) => set({ query }),

  load: async () => {
    set({ loading: true, error: null })
    try {
      const snap = await listMarketplacePlugins()
      set({
        sources: snap.sources,
        entries: snap.entries,
        loaded: true,
        loading: false,
      })
    } catch (err) {
      set({
        loading: false,
        loaded: true,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },

  refresh: async (sourceId) => {
    set({ refreshing: true, error: null })
    try {
      await refreshMarketplaceCatalog(sourceId)
      const snap = await listMarketplacePlugins()
      set({
        sources: snap.sources,
        entries: snap.entries,
        refreshing: false,
      })
    } catch (err) {
      // Still reload snapshot (may have partial cache)
      try {
        const snap = await listMarketplacePlugins()
        set({ sources: snap.sources, entries: snap.entries })
      } catch {
        /* ignore */
      }
      set({
        refreshing: false,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  },

  setSourceEnabled: async (sourceId, enabled) => {
    await setMarketplaceSourceEnabled(sourceId, enabled)
    const sources = await listMarketplaceSources()
    const snap = await listMarketplacePlugins()
    set({ sources, entries: snap.entries })
  },

  download: async (entry) => {
    const install = entry.install
    if (!install) {
      throw new Error(entry.installBlockedReason ?? 'Cannot download this plugin')
    }
    set({ downloadingKey: entry.key, error: null, lastModelReview: null })
    useDomainStore.getState().clearPluginInstall()

    // Mark UI downloading
    set({
      entries: get().entries.map((e) =>
        e.key === entry.key ? { ...e, downloadState: 'downloading' as const } : e,
      ),
    })

    try {
      wsClient.send({
        type: 'plugin:install:url',
        url: install.url,
        sha: install.sha,
        ref: install.ref,
        subpath: install.subpath,
        marketSourceId: entry.marketSourceId,
        marketPluginName: entry.name,
        runModelReview: true,
        startDisabled: true,
      })

      const result = await waitForPluginInstall()
      if (!result.ok) {
        set({
          downloadingKey: null,
          lastModelReview: result.modelReview ?? null,
          entries: get().entries.map((e) =>
            e.key === entry.key
              ? { ...e, downloadState: 'review_failed' as const }
              : e,
          ),
          error: result.error ?? 'Download failed',
        })
        throw new Error(result.error ?? 'Download failed')
      }

      const snap = await listMarketplacePlugins()
      set({
        sources: snap.sources,
        entries: snap.entries,
        downloadingKey: null,
        lastModelReview: result.modelReview ?? null,
      })
    } catch (err) {
      set({
        downloadingKey: null,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  },

  filteredEntries: () => {
    const { entries, tab, query } = get()
    return filterEntries(entries, tab, query)
  },
}))

export function matchInstallSpecSearch(
  install: MarketInstallSpec | null,
  query: string,
): boolean {
  if (!install || !query) return true
  return install.url.toLowerCase().includes(query.toLowerCase())
}

export { filterEntries }
