import { create } from 'zustand'
import type {
  McpRegistryEntry,
  McpRegistrySourceState,
  McpRegistryTab,
  McpServerConfig,
} from '@hip/protocol'
import {
  addMcpRegistrySource,
  listMcpRegistryServers,
  listMcpRegistrySources,
  refreshMcpRegistryCatalog,
  removeMcpRegistrySource,
  setMcpRegistrySourceEnabled,
} from '@/ipc/mcpRegistry'

/** Overlay install state from local hip.toml mcpServers onto catalog entries. */
export function overlayMcpInstallState(
  entries: McpRegistryEntry[],
  servers: McpServerConfig[],
): McpRegistryEntry[] {
  return entries.map((e) => {
    const local = servers.find(
      (s) =>
        s.registryName === e.name &&
        (s.registrySourceId === e.marketSourceId || !s.registrySourceId),
    )
    if (local) {
      return {
        ...e,
        installState: 'installed' as const,
        enabled: local.enabled,
        localServerId: local.id,
      }
    }
    return {
      ...e,
      installState: 'not_installed' as const,
      enabled: false,
      localServerId: undefined,
    }
  })
}

interface McpRegistryStore {
  sources: McpRegistrySourceState[]
  entries: McpRegistryEntry[]
  loaded: boolean
  loading: boolean
  refreshing: boolean
  adding: boolean
  error: string | null
  tab: McpRegistryTab
  query: string

  setTab: (tab: McpRegistryTab) => void
  setQuery: (q: string) => void
  load: () => Promise<void>
  refresh: (sourceId?: string) => Promise<void>
  setSourceEnabled: (sourceId: string, enabled: boolean) => Promise<void>
  addSource: (registryUrl: string) => Promise<void>
  removeSource: (sourceId: string) => Promise<void>
  filteredEntries: () => McpRegistryEntry[]
}

export function filterMcpRegistryEntries(
  entries: McpRegistryEntry[],
  tab: McpRegistryTab,
  query: string,
): McpRegistryEntry[] {
  const q = query.trim().toLowerCase()
  let list =
    tab === 'custom' ? [] : entries.filter((e) => e.marketSourceId === tab)
  if (q) {
    list = list.filter((e) => {
      const hay = [e.name, e.title, e.description, e.version]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }
  return [...list].sort((a, b) => {
    const rank = (e: McpRegistryEntry) => (e.installState === 'installed' ? 0 : 1)
    return rank(a) - rank(b) || a.name.localeCompare(b.name)
  })
}

export const useMcpRegistryStore = create<McpRegistryStore>((set, get) => ({
  sources: [],
  entries: [],
  loaded: false,
  loading: false,
  refreshing: false,
  adding: false,
  error: null,
  tab: 'mcp-official',
  query: '',

  setTab: (tab) => set({ tab }),
  setQuery: (query) => set({ query }),

  load: async () => {
    const first = !get().loaded
    set(first ? { loading: true, error: null } : { error: null })
    try {
      const snap = await listMcpRegistryServers()
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
      await refreshMcpRegistryCatalog(sourceId)
      const snap = await listMcpRegistryServers()
      set({
        sources: snap.sources,
        entries: snap.entries,
        refreshing: false,
      })
    } catch (err) {
      try {
        const snap = await listMcpRegistryServers()
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
    await setMcpRegistrySourceEnabled(sourceId, enabled)
    const sources = await listMcpRegistrySources()
    const snap = await listMcpRegistryServers()
    set({ sources, entries: snap.entries })
  },

  addSource: async (registryUrl) => {
    set({ adding: true, error: null })
    try {
      await addMcpRegistrySource(registryUrl)
      const snap = await listMcpRegistryServers()
      set({
        sources: snap.sources,
        entries: snap.entries,
        adding: false,
      })
    } catch (err) {
      set({
        adding: false,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  },

  removeSource: async (sourceId) => {
    set({ error: null })
    try {
      await removeMcpRegistrySource(sourceId)
      const snap = await listMcpRegistryServers()
      const tab = get().tab
      set({
        sources: snap.sources,
        entries: snap.entries,
        tab: tab === sourceId ? 'custom' : tab,
      })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
      throw err
    }
  },

  filteredEntries: () => {
    const { entries, tab, query } = get()
    return filterMcpRegistryEntries(entries, tab, query)
  },
}))
