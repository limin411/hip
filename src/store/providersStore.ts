// src/store/providersStore.ts
import { create } from 'zustand'
import type { ProvidersConfig } from '@hip/protocol'
import { fetchCatalog, isCompatible, type Catalog, type CatalogProvider } from '@/ipc/catalog'
import { getProvidersConfig, setProvidersConfig } from '@/ipc/providersConfig'
import { isProviderKeyConfigured, saveProviderKey, clearProviderKey, restartSidecar } from '@/ipc/secrets'
import { sessionService } from '@/domain/sessionService'

interface ProvidersStore {
  catalog: Catalog
  config: ProvidersConfig
  keyConfigured: Record<string, boolean>
  loaded: boolean
  load: () => Promise<void>
  saveKey: (providerID: string, value: string) => Promise<void>
  clearKey: (providerID: string) => Promise<void>
  setBaseURL: (providerID: string, baseURL: string) => Promise<void>
  addCustom: (providerID: string, name: string, baseURL: string, modelIDs: string[]) => Promise<void>
  setActiveModel: (providerID: string, modelID: string) => Promise<void>
}

/** Merge user `custom` providers into the catalog so the list renders them too. */
function mergeCustom(catalog: Catalog, config: ProvidersConfig): Catalog {
  const out: Catalog = { ...catalog }
  for (const [id, entry] of Object.entries(config.providers)) {
    if (entry.custom && !out[id]) {
      out[id] = { id, name: entry.custom.name, env: [], models: {}, custom: true, api: entry.baseURL }
    }
  }
  return out
}

function resolveBaseURL(p: CatalogProvider | undefined, config: ProvidersConfig, id: string): string {
  return config.providers[id]?.baseURL ?? p?.api ?? ''
}

export const useProvidersStore = create<ProvidersStore>((set, get) => ({
  catalog: {},
  config: { providers: {} },
  keyConfigured: {},
  loaded: false,

  load: async () => {
    const [catalogRaw, config] = await Promise.all([fetchCatalog(), getProvidersConfig()])
    const catalog = mergeCustom(catalogRaw, config)
    const ids = Object.keys(catalog).filter((id) => isCompatible(catalog[id]))
    const flags = await Promise.all(ids.map((id) => isProviderKeyConfigured(id).then((c) => [id, c] as const)))
    set({ catalog, config, keyConfigured: Object.fromEntries(flags), loaded: true })
  },

  saveKey: async (providerID, value) => {
    await saveProviderKey(providerID, value)
    // Enable + persist so spawn injects this key, then restart to pick it up.
    const config = get().config
    const next: ProvidersConfig = {
      ...config,
      providers: {
        ...config.providers,
        [providerID]: {
          ...config.providers[providerID],
          enabled: true,
          baseURL: resolveBaseURL(get().catalog[providerID], config, providerID),
        },
      },
    }
    await setProvidersConfig(next)
    await restartSidecar()
    set((s) => ({ config: next, keyConfigured: { ...s.keyConfigured, [providerID]: true } }))
  },

  clearKey: async (providerID) => {
    await clearProviderKey(providerID)
    await restartSidecar()
    set((s) => ({ keyConfigured: { ...s.keyConfigured, [providerID]: false } }))
  },

  setBaseURL: async (providerID, baseURL) => {
    const config = get().config
    const next: ProvidersConfig = {
      ...config,
      providers: { ...config.providers, [providerID]: { ...config.providers[providerID], enabled: config.providers[providerID]?.enabled ?? false, baseURL } },
    }
    await setProvidersConfig(next)
    set({ config: next })
  },

  addCustom: async (providerID, name, baseURL, modelIDs) => {
    const config = get().config
    const next: ProvidersConfig = {
      ...config,
      providers: { ...config.providers, [providerID]: { enabled: true, baseURL, custom: { name } } },
    }
    await setProvidersConfig(next)
    set((s) => ({
      config: next,
      catalog: {
        ...s.catalog,
        [providerID]: { id: providerID, name, env: [], custom: true, api: baseURL, models: Object.fromEntries(modelIDs.map((m) => [m, { id: m, name: m }])) },
      },
    }))
  },

  setActiveModel: async (providerID, modelID) => {
    const config = get().config
    const baseURL = resolveBaseURL(get().catalog[providerID], config, providerID)
    const next: ProvidersConfig = { ...config, activeModel: { providerID, modelID } }
    await setProvidersConfig(next)
    sessionService.setActiveModel(providerID, modelID, baseURL)
    set({ config: next })
  },
}))
