import { create } from 'zustand'
import type { PluginMeta } from '@hip/protocol'
import { listPlugins, installPluginZip, deletePlugin } from '@/ipc/plugins'

interface PluginsStore {
  plugins: PluginMeta[]
  loaded: boolean
  load: () => Promise<void>
  install: (zipPath: string) => Promise<void>
  remove: (id: string) => Promise<void>
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
}))
