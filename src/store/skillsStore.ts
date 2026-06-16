import { create } from 'zustand'
import type { SkillMeta } from '@hip/protocol'
import {
  listSkills,
  installSkillZip,
  deleteSkill,
  getSkillsConfig,
  setSkillsConfig,
} from '@/ipc/skills'

interface SkillsStore {
  skills: SkillMeta[]
  enabled: Record<string, boolean>
  loaded: boolean
  load: () => Promise<void>
  toggle: (id: string, on: boolean) => Promise<void>
  install: (zipPath: string) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const useSkillsStore = create<SkillsStore>((set, get) => ({
  skills: [],
  enabled: {},
  loaded: false,
  load: async () => {
    const [skills, cfg] = await Promise.all([listSkills(), getSkillsConfig()])
    set({ skills, enabled: cfg.enabled, loaded: true })
  },
  toggle: async (id, on) => {
    const enabled = { ...get().enabled, [id]: on }
    await setSkillsConfig({ enabled })
    set({ enabled })
  },
  install: async (zipPath) => {
    await installSkillZip(zipPath)
    const [skills, cfg] = await Promise.all([listSkills(), getSkillsConfig()])
    set({ skills, enabled: cfg.enabled })
  },
  remove: async (id) => {
    await deleteSkill(id)
    const enabled = { ...get().enabled }
    delete enabled[id]
    await setSkillsConfig({ enabled })
    set({ skills: get().skills.filter((s) => s.id !== id), enabled })
  },
}))
