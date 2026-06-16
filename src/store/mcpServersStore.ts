import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type { McpServerConfig } from '@hip/protocol'
import { getMcpServersConfig, setMcpServersConfig } from '@/ipc/mcpServersConfig'

interface McpServersStore {
  servers: McpServerConfig[]
  loaded: boolean
  load: () => Promise<void>
  addServer: (s: Omit<McpServerConfig, 'id'>) => Promise<void>
  updateServer: (id: string, patch: Partial<McpServerConfig>) => Promise<void>
  removeServer: (id: string) => Promise<void>
}

export const useMcpServersStore = create<McpServersStore>((set, get) => ({
  servers: [],
  loaded: false,
  load: async () => {
    const cfg = await getMcpServersConfig()
    set({ servers: cfg.servers, loaded: true })
  },
  addServer: async (s) => {
    const next = [...get().servers, { ...s, id: nanoid() }]
    await setMcpServersConfig({ servers: next })
    set({ servers: next })
  },
  updateServer: async (id, patch) => {
    const next = get().servers.map((x) => (x.id === id ? { ...x, ...patch } : x))
    await setMcpServersConfig({ servers: next })
    set({ servers: next })
  },
  removeServer: async (id) => {
    const next = get().servers.filter((x) => x.id !== id)
    await setMcpServersConfig({ servers: next })
    set({ servers: next })
  },
}))
