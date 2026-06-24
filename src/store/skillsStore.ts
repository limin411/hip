import { create } from 'zustand'
import type { SkillMeta, SkillEntry } from '@hip/protocol'
import {
  listSkills,
  installSkillZip,
  deleteSkill,
} from '@/ipc/skills'
import { useHipConfigStore } from '@/store/hipConfigStore'

interface SkillsStore {
  skills: SkillMeta[]
  enabled: Record<string, boolean>
  loaded: boolean
  load: () => Promise<void>
  toggle: (id: string, on: boolean) => Promise<void>
  install: (zipPath: string) => Promise<void>
  remove: (id: string) => Promise<void>
}

function entriesToEnabled(entries: SkillEntry[] | undefined): Record<string, boolean> {
  const map: Record<string, boolean> = {}
  for (const e of entries ?? []) {
    map[e.id] = e.enabled
  }
  return map
}

function enabledToEntries(enabled: Record<string, boolean>): SkillEntry[] {
  return Object.entries(enabled).map(([id, on]) => ({ id, enabled: on }))
}

export const useSkillsStore = create<SkillsStore>((set, get) => ({
  skills: [],
  enabled: {},
  loaded: false,
  load: async () => {
    const [skills] = await Promise.all([listSkills(), useHipConfigStore.getState().load()])
    set({ skills, enabled: entriesToEnabled(useHipConfigStore.getState().config.skills), loaded: true })
  },
  toggle: async (id, on) => {
    const enabled = { ...get().enabled, [id]: on }
    await useHipConfigStore.getState().updateSection('skills', enabledToEntries(enabled))
    set({ enabled })
  },
  install: async (zipPath) => {
    await installSkillZip(zipPath)
    const [skills] = await Promise.all([listSkills(), useHipConfigStore.getState().load()])
    set({ skills, enabled: entriesToEnabled(useHipConfigStore.getState().config.skills) })
  },
  remove: async (id) => {
    await deleteSkill(id)
    const enabled = { ...get().enabled }
    delete enabled[id]
    await useHipConfigStore.getState().updateSection('skills', enabledToEntries(enabled))
    set({ skills: get().skills.filter((s) => s.id !== id), enabled })
  },
}))
