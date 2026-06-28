import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
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
  updateSection: <K extends keyof HipConfig>(
    section: K,
    valueOrUpdater: HipConfig[K] | ((prev: HipConfig[K]) => HipConfig[K]),
  ) => Promise<void>
  /** Atomically merge several top-level sections at once (e.g. providers + activeModel),
   *  then persist. Use when one logical write spans more than one section. */
  updateSections: (patch: Partial<HipConfig>) => Promise<void>
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
    try {
      await setHipConfig(config)
      set({ config, error: null })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to save config'
      set({ error: msg })
      throw e
    }
  },

  updateSection: async <K extends keyof HipConfig>(
    section: K,
    valueOrUpdater: HipConfig[K] | ((prev: HipConfig[K]) => HipConfig[K]),
  ) => {
    // Atomically derive and write Zustand state — no async gap between read and write.
    // setHipConfig is a best-effort side effect that runs AFTER the atomic update.
    set((state) => {
      const prev = state.config[section]
      // TypeScript can't narrow generic indexed-access types through typeof;
      // all callers use ?? [] guard.
      const value =
        typeof valueOrUpdater === 'function'
          ? (valueOrUpdater as (prev: HipConfig[K]) => HipConfig[K])(prev as HipConfig[K] & NonNullable<HipConfig[K]>)
          : valueOrUpdater
      return { config: { ...state.config, [section]: value }, error: null }
    })
    // Best-effort TOML persist after the atomic Zustand update
    try {
      await setHipConfig(get().config)
    } catch (e) {
      const msg = e instanceof Error ? e.message : `Failed to persist ${String(section)}`
      set({ error: msg })
      throw e
    }
  },

  updateSections: async (patch) => {
    // Atomically merge a multi-section patch into the LATEST state (no async gap between
    // read and write), then persist once. Reading state inside set() means a concurrent
    // updateSection on a different section is not clobbered by a stale-snapshot whole-config
    // write — the bug that arose when this path went through save(snapshot).
    set((state) => ({ config: { ...state.config, ...patch }, error: null }))
    try {
      await setHipConfig(get().config)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to persist config'
      set({ error: msg })
      throw e
    }
  },
}))

// ── Selectors ──────────────────────────────────────────────────

/** Select MCP server configurations. */
export const useMcpServers = (): McpServerConfig[] =>
  useHipConfigStore(useShallow((s) => s.config.mcpServers ?? []))

/** Select skill enable/disable entries. */
export const useSkills = (): SkillEntry[] =>
  useHipConfigStore(useShallow((s) => s.config.skills ?? []))

/** Select provider entries. */
export const useProviders = (): ProviderEntry[] =>
  useHipConfigStore(useShallow((s) => s.config.providers ?? []))

/** Select agent configurations. */
export const useAgents = (): AgentConfig[] =>
  useHipConfigStore(useShallow((s) => s.config.agents ?? []))
