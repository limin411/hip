import { create } from 'zustand'
import type { PluginMeta } from '@hip/protocol'
import {
  listPlugins,
  installPluginZip,
  deletePlugin,
  setPluginEnabled,
} from '@/ipc/plugins'
import { wsClient } from '@/ipc/ws-client'

interface PluginsStore {
  plugins: PluginMeta[]
  loaded: boolean
  load: () => Promise<void>
  install: (zipPath: string) => Promise<void>
  remove: (id: string) => Promise<void>
  toggle: (id: string, enabled: boolean) => Promise<void>
}

/** Ask sidecar sessions to drop/reload plugin components after registry change. */
function notifyPluginReload(): void {
  try {
    wsClient.send({ type: 'plugin:reload' })
  } catch {
    /* app may not be connected yet */
  }
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
    notifyPluginReload()
  },
  remove: async (id) => {
    await deletePlugin(id)
    set({ plugins: get().plugins.filter((p) => p.id !== id) })
    notifyPluginReload()
  },
  toggle: async (id, enabled) => {
    // Optimistic UI update so skill/MCP/hook pages immediately reflect disabled parent.
    set({
      plugins: get().plugins.map((p) => (p.id === id ? { ...p, enabled } : p)),
    })
    try {
      await setPluginEnabled(id, enabled)
      const plugins = await listPlugins()
      set({ plugins })
      notifyPluginReload()
    } catch (err) {
      // Revert on failure
      const plugins = await listPlugins()
      set({ plugins })
      throw err
    }
  },
}))
