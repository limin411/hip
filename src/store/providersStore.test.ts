import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Catalog } from '@/ipc/catalog'
import {
  providerEntriesToConfig,
  configToProviderEntries,
  resolveActiveModel,
} from './providersStore.js'

// Real hipConfigStore + agentsStore are used; only the IPC / catalog / secrets /
// sessionService edges are mocked so the store wiring under test is exercised.
const getHipConfig = vi.fn()
const setHipConfig = vi.fn()
vi.mock('@/ipc/hipConfig', () => ({
  getHipConfig: (...a: unknown[]) => getHipConfig(...a),
  setHipConfig: (...a: unknown[]) => setHipConfig(...a),
}))

const fetchCatalog = vi.fn()
const refreshCatalogIpc = vi.fn()
vi.mock('@/ipc/catalog', () => ({
  fetchCatalog: (...a: unknown[]) => fetchCatalog(...a),
  refreshCatalog: (...a: unknown[]) => refreshCatalogIpc(...a),
  // Skip key-config probing in load(): no provider is "compatible" so the flags loop is empty.
  isCompatible: () => false,
}))

vi.mock('@/ipc/secrets', () => ({
  areProviderKeysConfigured: vi.fn().mockResolvedValue({}),
  saveProviderKey: vi.fn().mockResolvedValue(undefined),
  clearProviderKey: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/domain/sessionService', () => ({
  sessionService: { setActiveModel: vi.fn() },
}))

beforeEach(async () => {
  vi.clearAllMocks()
  getHipConfig.mockResolvedValue({ version: 1 })
  setHipConfig.mockResolvedValue(undefined)
  fetchCatalog.mockResolvedValue({})
  refreshCatalogIpc.mockResolvedValue({})
  const { useHipConfigStore } = await import('./hipConfigStore.js')
  const { useProvidersStore } = await import('./providersStore.js')
  useHipConfigStore.setState({ config: { version: 1 }, loaded: false, error: null })
  useProvidersStore.setState({
    catalog: {},
    config: { providers: {} },
    keyConfigured: {},
    loaded: false,
    catalogRefreshing: false,
    catalogRefreshedAt: 0,
  })
})

describe('providersStore ⇄ hipConfig cross-store writes', () => {
  it('persisting a provider change does not drop a concurrently-added agent', async () => {
    getHipConfig.mockResolvedValue({
      version: 1,
      providers: [{ id: 'deepseek', name: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', enabled: true }],
    })
    const { useProvidersStore } = await import('./providersStore.js')
    const { useAgentsStore } = await import('./agentsStore.js')
    const { useHipConfigStore } = await import('./hipConfigStore.js')

    await useProvidersStore.getState().load()
    // drain background revalidation kicked off by load()
    await vi.waitFor(() => expect(refreshCatalogIpc).toHaveBeenCalled())

    // Race a provider persist against an agent add — they touch DIFFERENT sections.
    await Promise.all([
      useProvidersStore.getState().setEnabled('deepseek', false),
      useAgentsStore.getState().addAgent({ name: 'Brand New', kind: 'acp', command: 'cmd', args: [], enabled: true }),
    ])

    const cfg = useHipConfigStore.getState().config
    expect(cfg.agents?.map((a) => a.name)).toContain('Brand New')
    expect(cfg.providers?.find((p) => p.id === 'deepseek')?.enabled).toBe(false)
  })
})

describe('providersStore catalog SWR', () => {
  it('load() uses local fetchCatalog then background refreshCatalog', async () => {
    const local: Catalog = {
      openai: {
        id: 'openai',
        name: 'OpenAI',
        env: [],
        models: {
          'gpt-4o': { id: 'gpt-4o', name: 'GPT-4o' },
        },
      },
    }
    const remote: Catalog = {
      openai: {
        id: 'openai',
        name: 'OpenAI',
        env: [],
        models: {
          'gpt-4o': { id: 'gpt-4o', name: 'GPT-4o' },
          'gpt-5.4': {
            id: 'gpt-5.4',
            name: 'GPT-5.4',
            reasoning: true,
            reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high'] }],
          },
        },
      },
    }
    fetchCatalog.mockResolvedValue(local)
    let resolveRefresh!: (c: Catalog) => void
    refreshCatalogIpc.mockReturnValue(
      new Promise<Catalog>((r) => {
        resolveRefresh = r
      }),
    )

    const { useProvidersStore } = await import('./providersStore.js')
    await useProvidersStore.getState().load()

    expect(useProvidersStore.getState().loaded).toBe(true)
    expect(useProvidersStore.getState().catalog.openai?.models['gpt-4o']).toBeDefined()
    expect(useProvidersStore.getState().catalog.openai?.models['gpt-5.4']).toBeUndefined()
    expect(useProvidersStore.getState().catalogRefreshing).toBe(true)

    resolveRefresh(remote)
    await vi.waitFor(() => expect(useProvidersStore.getState().catalogRefreshing).toBe(false))

    expect(useProvidersStore.getState().catalog.openai?.models['gpt-5.4']?.reasoning_options).toEqual([
      { type: 'effort', values: ['low', 'medium', 'high'] },
    ])
    expect(useProvidersStore.getState().catalogRefreshedAt).toBeGreaterThan(0)
  })

  it('refreshCatalog failure keeps the previous catalog', async () => {
    const local: Catalog = {
      openai: { id: 'openai', name: 'OpenAI', env: [], models: { 'gpt-4o': { id: 'gpt-4o', name: 'GPT-4o' } } },
    }
    fetchCatalog.mockResolvedValue(local)
    refreshCatalogIpc.mockRejectedValue(new Error('network down'))

    const { useProvidersStore } = await import('./providersStore.js')
    await useProvidersStore.getState().load()
    await vi.waitFor(() => expect(useProvidersStore.getState().catalogRefreshing).toBe(false))

    expect(useProvidersStore.getState().catalog.openai?.models['gpt-4o']).toBeDefined()
    expect(useProvidersStore.getState().catalogRefreshedAt).toBe(0)
  })

  it('refreshCatalog is a no-op while already refreshing', async () => {
    let resolveRefresh!: (c: Catalog) => void
    refreshCatalogIpc.mockReturnValue(
      new Promise<Catalog>((r) => {
        resolveRefresh = r
      }),
    )
    const { useProvidersStore } = await import('./providersStore.js')
    useProvidersStore.setState({
      catalog: {},
      config: { providers: {} },
      loaded: true,
      catalogRefreshing: false,
      catalogRefreshedAt: 0,
    })

    const p1 = useProvidersStore.getState().refreshCatalog()
    const p2 = useProvidersStore.getState().refreshCatalog()
    expect(await p2).toBe(false)
    expect(refreshCatalogIpc).toHaveBeenCalledTimes(1)

    resolveRefresh({})
    expect(await p1).toBe(true)
  })
})

describe('providersStore ProviderEntry[] ⇄ ProvidersConfig conversion', () => {
  const catalog: Catalog = {
    deepseek: { id: 'deepseek', name: 'DeepSeek', env: [], models: {}, api: 'https://api.deepseek.com/v1' },
  }

  it('round-trips built-in and custom providers preserving enabled, name, baseURL and apiKind', () => {
    const entries = [
      { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', enabled: true },
      {
        id: 'mycustom',
        name: 'My Custom',
        baseUrl: 'https://custom.test/v1',
        enabled: false,
        apiKind: 'anthropic' as const,
      },
    ]
    const config = providerEntriesToConfig(entries, catalog)

    // built-in: no `custom` tag; custom: tagged with its name
    expect(config.providers.deepseek).toEqual({ enabled: true, baseURL: 'https://api.deepseek.com/v1' })
    expect(config.providers.mycustom).toEqual({
      enabled: false,
      baseURL: 'https://custom.test/v1',
      apiKind: 'anthropic',
      custom: { name: 'My Custom' },
    })

    const back = configToProviderEntries(config, catalog)
    expect(back).toEqual(entries)
  })

  it('treats an empty baseUrl as no override and round-trips it back to empty', () => {
    const entries = [{ id: 'deepseek', name: 'DeepSeek', baseUrl: '', enabled: true }]
    const config = providerEntriesToConfig(entries, catalog)
    expect(config.providers.deepseek.baseURL).toBeUndefined()
    expect(configToProviderEntries(config, catalog)).toEqual(entries)
  })

  it('resolveActiveModel resolves baseURL from the provider override, then the catalog', () => {
    expect(
      resolveActiveModel({ providers: { deepseek: { enabled: true, baseURL: 'https://override/v1' } }, activeModel: { providerID: 'deepseek', modelID: 'm' } }, catalog),
    ).toEqual({ providerID: 'deepseek', modelID: 'm', baseURL: 'https://override/v1' })

    // no override → catalog `api`
    expect(
      resolveActiveModel({ providers: { deepseek: { enabled: true } }, activeModel: { providerID: 'deepseek', modelID: 'm' } }, catalog),
    ).toEqual({ providerID: 'deepseek', modelID: 'm', baseURL: 'https://api.deepseek.com/v1' })

    expect(resolveActiveModel({ providers: {} }, catalog)).toBeUndefined()
  })
})
