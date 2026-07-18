import { create } from 'zustand'
import type { PluginMeta } from '@hip/protocol'
import {
  listPlugins,
  installPluginZip,
  deletePlugin,
  setPluginEnabled,
} from '@/ipc/plugins'

interface PluginsStore {
  plugins: PluginMeta[]
  loaded: boolean
  load: () => Promise<void>
  install: (zipPath: string) => Promise<void>
  remove: (id: string) => Promise<void>
  toggle: (id: string, enabled: boolean) => Promise<void>
}

export const usePluginsStore = create<PluginsStore>((set, get) => ({
  plugins: [],
  loaded: false,
  load: async () => {
    const plugins = await listPlugins()
    set({ plugins, loaded: true })
  },
  install: async (zipPath) => {
    await installPluginZip(zipPath)
    const plugins = await listPlugins()
    set({ plugins })
  },
  remove: async (id) => {
    await deletePlugin(id)
    set({ plugins: get().plugins.filter((p) => p.id !== id) })
  },
  toggle: async (id, enabled) => {
    // Optimistic UI update
    set({
      plugins: get().plugins.map((p) => (p.id === id ? { ...p, enabled } : p)),
    })
    try {
      await setPluginEnabled(id, enabled)
      const plugins = await listPlugins()
      set({ plugins })
    } catch (err) {
      // Revert on failure
      const plugins = await listPlugins()
      set({ plugins })
      throw err
    }
  },
}))
