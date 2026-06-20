import { create } from 'zustand'
import type {
  HipConfig,
  McpServerConfig,
  SkillEntry,
  ProviderEntry,
  AgentConfig,
} from '@hip/protocol'
import { getHipConfig, setHipConfig } from '@/ipc/hipConfig'

interface HipConfigStore {
  config: HipConfig
  loaded: boolean
  error: string | null
  load: () => Promise<void>
  save: (config: HipConfig) => Promise<void>
  updateSection: <K extends keyof HipConfig>(section: K, value: HipConfig[K]) => Promise<void>
}

/**
 * Unified store for the TOML-based HipConfig.
 *
 * Replaces individual per-domain stores (mcpServersStore, skillsStore, providersStore)
 * which are now **@deprecated** — prefer the selectors exported from this store.
 */
export const useHipConfigStore = create<HipConfigStore>((set, get) => ({
  config: { version: 1 },
  loaded: false,
  error: null,

  load: async () => {
    try {
      const config = await getHipConfig()
      set({ config, loaded: true, error: null })
    } catch (e) {
      set({
        loaded: true,
        error: e instanceof Error ? e.message : 'Failed to load config',
      })
    }
  },

  save: async (config) => {
    await setHipConfig(config)
    set({ config, error: null })
  },

  updateSection: async (section, value) => {
    const next = { ...get().config, [section]: value }
    await setHipConfig(next)
    set({ config: next, error: null })
  },
}))

// ── Selectors ──────────────────────────────────────────────────

/** Select MCP server configurations. */
export const useMcpServers = (): McpServerConfig[] =>
  useHipConfigStore((s) => s.config.mcpServers ?? [])

/** Select skill enable/disable entries. */
export const useSkills = (): SkillEntry[] =>
  useHipConfigStore((s) => s.config.skills ?? [])

/** Select provider entries. */
export const useProviders = (): ProviderEntry[] =>
  useHipConfigStore((s) => s.config.providers ?? [])

/** Select agent configurations. */
export const useAgents = (): AgentConfig[] =>
  useHipConfigStore((s) => s.config.agents ?? [])
