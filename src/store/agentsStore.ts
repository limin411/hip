import { create } from 'zustand'
import { nanoid } from 'nanoid'
import type { AgentConfig } from '@hip/protocol'
import { useHipConfigStore, useAgents } from '@/store/hipConfigStore'

interface AgentsStore {
  agents: AgentConfig[]
  loaded: boolean
  load: () => Promise<void>
  addAgent: (a: Omit<AgentConfig, 'id'>) => Promise<string>
  updateAgent: (id: string, patch: Partial<AgentConfig>) => Promise<void>
  removeAgent: (id: string) => Promise<void>
}

/**
 * @deprecated Prefer useHipConfigStore + useAgents() for new code.
 * This store is kept as a thin wrapper during the JSON→TOML migration
 * so existing UI components continue to work without immediate rewrites.
 */
export const useAgentsStore = create<AgentsStore>((set) => ({
  agents: [],
  loaded: false,
  load: async () => {
    await useHipConfigStore.getState().load()
    set({ agents: useAgents(), loaded: true })
  },
	  addAgent: async (a) => {
	    const id = nanoid()
	    const entry = { ...a, id }
	    await useHipConfigStore.getState().updateSection('agents', (prev) => [...(prev ?? []), entry])
	    set((state) => ({ agents: [...state.agents, entry] }))
	    return id
	  },
	  updateAgent: async (id, patch) => {
	    await useHipConfigStore.getState().updateSection('agents', (prev) =>
	      (prev ?? []).map((x) => (x.id === id ? { ...x, ...patch } : x)),
	    )
	    set((state) => ({ agents: state.agents.map((x) => (x.id === id ? { ...x, ...patch } : x)) }))
	  },
	  removeAgent: async (id) => {
	    await useHipConfigStore.getState().updateSection('agents', (prev) =>
	      (prev ?? []).filter((x) => x.id !== id),
	    )
	    set((state) => ({ agents: state.agents.filter((x) => x.id !== id) }))
	  },
}))
