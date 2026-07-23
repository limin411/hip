// src/store/providersStore.ts
import { create } from 'zustand'
import type { ActiveModel, ProviderApiKind, ProviderEntry, ProvidersConfig } from '@hip/protocol'
import { fetchCatalog, refreshCatalog, isCompatible, type Catalog, type CatalogProvider } from '@/ipc/catalog'
import { useHipConfigStore } from '@/store/hipConfigStore'
import { areProviderKeysConfigured, saveProviderKey, clearProviderKey } from '@/ipc/secrets'
import { sessionService } from '@/domain/sessionService'

/** Coordinates the models.dev catalog, the hip.toml provider config, and per-provider API
 *  keys. Every async action can reject (the underlying tauri `invoke` throws) — callers must
 *  try/catch and surface `settings.modelConfig.error`; the store does not hold an error field. */
interface ProvidersStore {
  catalog: Catalog
  config: ProvidersConfig
  keyConfigured: Record<string, boolean>
  loaded: boolean
  /** True while a background models.dev revalidation is in flight. */
  catalogRefreshing: boolean
  /** Epoch ms of the last successful network catalog refresh (0 if never). */
  catalogRefreshedAt: number
  load: () => Promise<void>
  /** Force network revalidation; merges into store on success. Safe to call repeatedly. */
  refreshCatalog: () => Promise<boolean>
  saveKey: (providerID: string, value: string) => Promise<void>
  clearKey: (providerID: string) => Promise<void>
  setBaseURL: (providerID: string, baseURL: string) => Promise<void>
  setEnabled: (providerID: string, enabled: boolean) => Promise<void>
  setApiKind: (providerID: string, apiKind: ProviderApiKind) => Promise<void>
  addCustom: (
    providerID: string,
    name: string,
    baseURL: string,
    modelIDs: string[],
    apiKind?: ProviderApiKind,
  ) => Promise<void>
  setActiveModel: (providerID: string, modelID: string) => Promise<void>
}

const DEEPSEEK_BASE = 'https://api.deepseek.com/v1'

/** First-run seed: DeepSeek enabled + active, so existing users see no change. */
function withDefaults(cfg: ProvidersConfig | null): ProvidersConfig {
  if (cfg && cfg.providers && Object.keys(cfg.providers).length > 0) return cfg
  return {
    providers: { deepseek: { enabled: true, baseURL: DEEPSEEK_BASE } },
    activeModel: { providerID: 'deepseek', modelID: 'deepseek-reasoner' },
  }
}

/** Catalog npm tag that matches sidecar Anthropic routing for custom providers. */
function catalogNpmForApiKind(apiKind: ProviderApiKind | undefined): string | undefined {
  return apiKind === 'anthropic' ? '@ai-sdk/anthropic' : undefined
}

/** Merge user `custom` providers into the catalog so the list renders them too. */
function mergeCustom(catalog: Catalog, config: ProvidersConfig): Catalog {
  const out: Catalog = { ...catalog }
  for (const [id, entry] of Object.entries(config.providers)) {
    if (entry.custom && !out[id]) {
      out[id] = {
        id,
        name: entry.custom.name,
        env: [],
        models: {},
        custom: true,
        api: entry.baseURL,
        ...(catalogNpmForApiKind(entry.apiKind) ? { npm: catalogNpmForApiKind(entry.apiKind) } : {}),
      }
    }
  }
  return out
}

function resolveBaseURL(p: CatalogProvider | undefined, config: ProvidersConfig, id: string): string {
  return config.providers[id]?.baseURL ?? p?.api ?? ''
}

function isCustomProvider(id: string, catalog: Catalog): boolean {
  return !catalog[id] || catalog[id].custom === true
}

/** Convert hip.toml ProviderEntry[] into the UI-friendly ProvidersConfig shape. */
export function providerEntriesToConfig(entries: ProviderEntry[] | undefined, catalog: Catalog): ProvidersConfig {
  const providers: ProvidersConfig['providers'] = {}
  for (const e of entries ?? []) {
    const entry: ProvidersConfig['providers'][string] = {
      enabled: e.enabled,
      baseURL: e.baseUrl || undefined,
      ...(e.apiKind ? { apiKind: e.apiKind } : {}),
    }
    if (isCustomProvider(e.id, catalog)) {
      entry.custom = { name: e.name }
    }
    providers[e.id] = entry
  }
  return { providers }
}

/** Convert the UI-friendly ProvidersConfig into hip.toml ProviderEntry[]. */
export function configToProviderEntries(config: ProvidersConfig, catalog: Catalog): ProviderEntry[] {
  return Object.entries(config.providers).map(([id, entry]) => ({
    id,
    name: entry.custom?.name ?? catalog[id]?.name ?? id,
    baseUrl: entry.baseURL ?? '',
    enabled: entry.enabled,
    ...(entry.apiKind ? { apiKind: entry.apiKind } : {}),
  }))
}

/** Build the full ActiveModel (with resolved baseURL) from the store's ProvidersConfig shape. */
export function resolveActiveModel(config: ProvidersConfig, catalog: Catalog): ActiveModel | undefined {
  const sel = config.activeModel
  if (!sel) return undefined
  const baseURL = resolveBaseURL(catalog[sel.providerID], config, sel.providerID)
  return { providerID: sel.providerID, modelID: sel.modelID, baseURL }
}

export const useProvidersStore = create<ProvidersStore>((set, get) => ({
  catalog: {},
  config: { providers: {} },
  keyConfigured: {},
  loaded: false,
  catalogRefreshing: false,
  catalogRefreshedAt: 0,

  load: async () => {
    // SWR step 1: local catalog only (disk cache / bundled snapshot) — never wait on network.
    const [catalogRaw] = await Promise.all([fetchCatalog(), useHipConfigStore.getState().load()])
    const hipConfig = useHipConfigStore.getState().config
    const config = withDefaults({
      ...providerEntriesToConfig(hipConfig.providers, catalogRaw),
      activeModel: hipConfig.activeModel
        ? { providerID: hipConfig.activeModel.providerID, modelID: hipConfig.activeModel.modelID }
        : undefined,
    })
    const catalog = mergeCustom(catalogRaw, config)
    const ids = Object.keys(catalog).filter((id) => isCompatible(catalog[id]))
    const configured = await areProviderKeysConfigured(ids)
    const flags = ids.map((id) => [id, !!configured[id]] as const)
    set({ catalog, config, keyConfigured: Object.fromEntries(flags), loaded: true })

    // SWR step 2: every app open revalidates models.dev; Effort levels / prices hot-swap on success.
    void get().refreshCatalog().catch((err) => {
      console.warn('[providersStore] catalog revalidation failed:', err)
    })
  },

  refreshCatalog: async () => {
    if (get().catalogRefreshing) return false
    set({ catalogRefreshing: true })
    try {
      const catalogRaw = await refreshCatalog()
      // Keep user config (enabled / baseURL / activeModel); only refresh model metadata.
      const { config } = get()
      const catalog = mergeCustom(catalogRaw, config)
      const ids = Object.keys(catalog).filter((id) => isCompatible(catalog[id]))
      const configured = await areProviderKeysConfigured(ids)
      const flags = Object.fromEntries(ids.map((id) => [id, !!configured[id]] as const))
      set({
        catalog,
        keyConfigured: { ...get().keyConfigured, ...flags },
        catalogRefreshing: false,
        catalogRefreshedAt: Date.now(),
      })
      return true
    } catch (err) {
      set({ catalogRefreshing: false })
      console.warn('[providersStore] refreshCatalog failed:', err)
      return false
    }
  },

  saveKey: async (providerID, value) => {
    await saveProviderKey(providerID, value)
    // Enable + persist baseURL. Sidecar resolves keys from auth.json on each
    // request (BYOK hot path) — no sidecar restart required.
    const config = get().config
    const baseURL = resolveBaseURL(get().catalog[providerID], config, providerID)
    const next: ProvidersConfig = {
      ...config,
      providers: {
        ...config.providers,
        [providerID]: {
          ...config.providers[providerID],
          enabled: true,
          baseURL,
        },
      },
    }
    await persistProvidersConfig(next, get().catalog)
    set((s) => ({ config: next, keyConfigured: { ...s.keyConfigured, [providerID]: true } }))
    // Refresh hasApiKey banner when the active provider's key changes.
    if (config.activeModel?.providerID === providerID && baseURL) {
      sessionService.setActiveModel(providerID, config.activeModel.modelID, baseURL)
    }
  },

  clearKey: async (providerID) => {
    // Tombstone "" in auth.json so env fallback cannot revive a cleared key.
    await clearProviderKey(providerID)
    set((s) => ({ keyConfigured: { ...s.keyConfigured, [providerID]: false } }))
    const { config, catalog } = get()
    if (config.activeModel?.providerID === providerID) {
      const baseURL = resolveBaseURL(catalog[providerID], config, providerID)
      if (baseURL) {
        sessionService.setActiveModel(providerID, config.activeModel.modelID, baseURL)
      }
    }
  },

  setBaseURL: async (providerID, baseURL) => {
    const config = get().config
    const next: ProvidersConfig = {
      ...config,
      providers: { ...config.providers, [providerID]: { ...config.providers[providerID], enabled: config.providers[providerID]?.enabled ?? false, baseURL } },
    }
    await persistProvidersConfig(next, get().catalog)
    set({ config: next })
    // If we just edited the ACTIVE provider's base URL, re-apply it live (a non-secret
    // config:setActiveModel, no restart) so the running sidecar adopts it immediately — otherwise
    // its active model keeps the old baseURL until the next re-select/restart.
    if (config.activeModel?.providerID === providerID) {
      sessionService.setActiveModel(providerID, config.activeModel.modelID, baseURL)
    }
  },

  setEnabled: async (providerID, enabled) => {
    const config = get().config
    const next: ProvidersConfig = {
      ...config,
      providers: {
        ...config.providers,
        [providerID]: {
          ...config.providers[providerID],
          enabled,
          baseURL: resolveBaseURL(get().catalog[providerID], config, providerID),
        },
      },
    }
    await persistProvidersConfig(next, get().catalog)
    set({ config: next })
  },

  setApiKind: async (providerID, apiKind) => {
    const config = get().config
    const prev = config.providers[providerID]
    const next: ProvidersConfig = {
      ...config,
      providers: {
        ...config.providers,
        [providerID]: {
          ...prev,
          enabled: prev?.enabled ?? true,
          apiKind,
        },
      },
    }
    await persistProvidersConfig(next, get().catalog)
    set((s) => {
      const cat = s.catalog[providerID]
      if (!cat?.custom) return { config: next }
      const npm = catalogNpmForApiKind(apiKind)
      return {
        config: next,
        catalog: {
          ...s.catalog,
          [providerID]: npm ? { ...cat, npm } : { ...cat, npm: undefined },
        },
      }
    })
  },

  // Note: addCustom persists config only. Call saveKey before making the provider active
  // so auth.json has a key (sidecar reads auth.json / env without restart).
  addCustom: async (providerID, name, baseURL, modelIDs, apiKind = 'openai') => {
    // Don't let a custom provider clobber a built-in catalog entry (e.g. name "OpenAI" → id "openai").
    const existing = get().catalog[providerID]
    if (existing && !existing.custom) throw new Error(`Provider id "${providerID}" already exists`)
    const config = get().config
    const next: ProvidersConfig = {
      ...config,
      providers: {
        ...config.providers,
        [providerID]: { enabled: true, baseURL, apiKind, custom: { name } },
      },
    }
    await persistProvidersConfig(next, get().catalog)
    const npm = catalogNpmForApiKind(apiKind)
    set((s) => ({
      config: next,
      catalog: {
        ...s.catalog,
        [providerID]: {
          id: providerID,
          name,
          env: [],
          custom: true,
          api: baseURL,
          ...(npm ? { npm } : {}),
          models: Object.fromEntries(modelIDs.map((m) => [m, { id: m, name: m }])),
        },
      },
    }))
  },

  setActiveModel: async (providerID, modelID) => {
    const config = get().config
    const baseURL = resolveBaseURL(get().catalog[providerID], config, providerID)
    // An empty base URL means the provider is unusable (no catalog `api`, no override). Refuse
    // rather than ship baseURL:'' to the sidecar's config:setActiveModel handler (which, unlike the
    // boot path, has no DEEPSEEK_DEFAULT fallback). Callers surface this via modelConfig.error.
    if (!baseURL) throw new Error(`No base URL configured for provider "${providerID}"`)
    const next: ProvidersConfig = { ...config, activeModel: { providerID, modelID } }
    await persistProvidersConfig(next, get().catalog)
    sessionService.setActiveModel(providerID, modelID, baseURL)
    set({ config: next })
  },
}))

/** Write the ProvidersConfig-shaped state back to hip.toml as ProviderEntry[] + activeModel.
 *  Uses the atomic multi-section update so a concurrent edit to another section (agents,
 *  skills, mcpServers) is not clobbered by a stale-snapshot whole-config write. */
async function persistProvidersConfig(config: ProvidersConfig, catalog: Catalog): Promise<void> {
  await useHipConfigStore.getState().updateSections({
    providers: configToProviderEntries(config, catalog),
    activeModel: resolveActiveModel(config, catalog),
  })
}
