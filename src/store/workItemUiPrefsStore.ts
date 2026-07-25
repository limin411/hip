import { create } from 'zustand'
import {
  DEFAULT_STATUS_COLORS,
  defaultWorkItemUiPrefs,
  normalizeWorkItemUiPrefs,
  type WorkItemColorMap,
  type WorkItemStatusColorKey,
  type WorkItemUiPrefsV1,
} from '@/domain/work-items'
import { listWorkItemUiPrefs, saveWorkItemUiPrefs } from '@/ipc/workItems'

type WorkItemUiPrefsStore = {
  loaded: boolean
  statusColors: WorkItemColorMap
  load: () => Promise<void>
  setStatusColor: (key: WorkItemStatusColorKey, hex: string) => Promise<void>
  resetColors: () => Promise<void>
}

function toPrefs(colors: WorkItemColorMap): WorkItemUiPrefsV1 {
  return { version: 1, statusColors: { ...colors } }
}

export const useWorkItemUiPrefsStore = create<WorkItemUiPrefsStore>((set, get) => ({
  loaded: false,
  statusColors: { ...DEFAULT_STATUS_COLORS },

  load: async () => {
    try {
      const prefs = await listWorkItemUiPrefs()
      set({ statusColors: prefs.statusColors, loaded: true })
    } catch {
      // Prefer defaults if IPC unavailable (unit tests / web).
      set({ statusColors: { ...DEFAULT_STATUS_COLORS }, loaded: true })
    }
  },

  setStatusColor: async (key, hex) => {
    const next = { ...get().statusColors, [key]: hex }
    const prefs = normalizeWorkItemUiPrefs(toPrefs(next))
    set({ statusColors: prefs.statusColors })
    try {
      await saveWorkItemUiPrefs(prefs)
    } catch {
      // keep in-memory
    }
  },

  resetColors: async () => {
    const prefs = defaultWorkItemUiPrefs()
    set({ statusColors: prefs.statusColors })
    try {
      await saveWorkItemUiPrefs(prefs)
    } catch {
      // keep in-memory
    }
  },
}))
