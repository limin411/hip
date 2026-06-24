// src/store/providersStore.ts
import { create } from 'zustand'
import type { ActiveModel, ProviderEntry, ProvidersConfig } from '@hip/protocol'
import { fetchCatalog, isCompatible, type Catalog, type CatalogProvider } from '@/ipc/catalog'
import { useHipConfigStore } from '@/store/hipConfigStore'
import { isProviderKeyConfigured, saveProviderKey, clearProviderKey, restartSidecar } from '@/ipc/secrets'
import { sessionService } from '@/domain/sessionService'

/** Coordinates the models.dev catalog, the hip.toml provider config, and per-provider API
 *  keys. Every async action can reject (the underlying tauri `invoke` throws) — callers must
 *  try/catch and surface `settings.modelConfig.error`; the store does not hold an error field. */
interface ProvidersStore {
  catalog: Catalog
  config: ProvidersConfig
  keyConfigured: Record<string, boolean>
  loaded: boolean
  load: () => Promise<void>
  saveKey: (providerID: string, value: string) => Promise<void>
  clearKey: (providerID: string) => Promise<void>
  setBaseURL: (providerID: string, baseURL: string) => Promise<void>
  setEnabled: (providerID: string, enabled: boolean) => Promise<void>
  addCustom: (providerID: string, name: string, baseURL: string, modelIDs: string[]) => Promise<void>
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

function isCustomProvider(id: string, catalog: Catalog): boolean {
  return !catalog[id] || catalog[id].custom === true
}

/** Convert hip.toml ProviderEntry[] into the UI-friendly ProvidersConfig shape. */
function providerEntriesToConfig(entries: ProviderEntry[] | undefined, catalog: Catalog): ProvidersConfig {
  const providers: ProvidersConfig['providers'] = {}
  for (const e of entries ?? []) {
    const entry: ProvidersConfig['providers'][string] = {
      enabled: e.enabled,
      baseURL: e.baseUrl || undefined,
    }
    if (isCustomProvider(e.id, catalog)) {
      entry.custom = { name: e.name }
    }
    providers[e.id] = entry
  }
  return { providers }
}

/** Convert the UI-friendly ProvidersConfig into hip.toml ProviderEntry[]. */
function configToProviderEntries(config: ProvidersConfig, catalog: Catalog): ProviderEntry[] {
  return Object.entries(config.providers).map(([id, entry]) => ({
    id,
    name: entry.custom?.name ?? catalog[id]?.name ?? id,
    baseUrl: entry.baseURL ?? '',
    enabled: entry.enabled,
  }))
}

/** Build the full ActiveModel (with resolved baseURL) from the store's ProvidersConfig shape. */
function resolveActiveModel(config: ProvidersConfig, catalog: Catalog): ActiveModel | undefined {
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

  load: async () => {
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
    await persistProvidersConfig(next, get().catalog)
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

  // Note: addCustom persists config but does NOT restart the sidecar, so the new provider's
  // HIP_MODEL_<ID>_API_KEY env is injected on the next saveKey() restart. The intended flow is
  // addCustom → saveKey (restart) before that provider is made active.
  addCustom: async (providerID, name, baseURL, modelIDs) => {
    // Don't let a custom provider clobber a built-in catalog entry (e.g. name "OpenAI" → id "openai").
    const existing = get().catalog[providerID]
    if (existing && !existing.custom) throw new Error(`Provider id "${providerID}" already exists`)
    const config = get().config
    const next: ProvidersConfig = {
      ...config,
      providers: { ...config.providers, [providerID]: { enabled: true, baseURL, custom: { name } } },
    }
    await persistProvidersConfig(next, get().catalog)
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

/** Write the ProvidersConfig-shaped state back to hip.toml as ProviderEntry[] + activeModel. */
async function persistProvidersConfig(config: ProvidersConfig, catalog: Catalog): Promise<void> {
  const hipConfig = useHipConfigStore.getState().config
  const activeModel = resolveActiveModel(config, catalog)
  const next: typeof hipConfig = {
    ...hipConfig,
    providers: configToProviderEntries(config, catalog),
    activeModel,
  }
  await useHipConfigStore.getState().save(next)
}
