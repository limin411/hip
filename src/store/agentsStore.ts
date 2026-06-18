import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type { AgentConfig } from '@hip/protocol'
import { getAgentsConfig, setAgentsConfig } from '@/ipc/agentsConfig'

const BUILTIN_OPENCODE: AgentConfig = {
  id: 'opencode', name: 'OpenCode', kind: 'acp', command: 'opencode', args: ['acp', '--pure'],
  transport: 'thin', acceptsModelConfig: true, authMode: 'opencode-self', quirks: 'opencode', enabled: false,
}

/** Ensure the built-in OpenCode agent is present exactly once, without clobbering user edits. */
export function withBuiltinOpencode(agents: AgentConfig[]): AgentConfig[] {
  return agents.some((a) => a.id === 'opencode') ? agents : [BUILTIN_OPENCODE, ...agents]
}

interface AgentsStore {
  agents: AgentConfig[]
  loaded: boolean
  load: () => Promise<void>
  addAgent: (a: Omit<AgentConfig, 'id'>) => Promise<string>
  updateAgent: (id: string, patch: Partial<AgentConfig>) => Promise<void>
  removeAgent: (id: string) => Promise<void>
}

export const useAgentsStore = create<AgentsStore>((set, get) => ({
  agents: [],
  loaded: false,
  load: async () => {
    const cfg = await getAgentsConfig()
    set({ agents: withBuiltinOpencode(cfg.agents), loaded: true })
  },
  addAgent: async (a) => {
    const id = nanoid()
    const next = [...get().agents, { ...a, id }]
    await setAgentsConfig({ agents: next })
    set({ agents: next })
    return id
  },
  updateAgent: async (id, patch) => {
    const next = get().agents.map((x) => (x.id === id ? { ...x, ...patch } : x))
    await setAgentsConfig({ agents: next })
    set({ agents: next })
  },
  removeAgent: async (id) => {
    const next = get().agents.filter((x) => x.id !== id)
    await setAgentsConfig({ agents: next })
    set({ agents: next })
  },
}))
