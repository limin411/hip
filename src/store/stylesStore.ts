import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'
import { nanoid } from 'nanoid'

export interface StylePreset {
  id: string
  name: string
  text: string
}

interface StylesStore {
  presets: StylePreset[]
  addPreset: (name: string, text: string) => StylePreset
  updatePreset: (id: string, patch: Partial<Pick<StylePreset, 'name' | 'text'>>) => void
  removePreset: (id: string) => void
}

// In-memory fallback so node test runs (no localStorage/DOM) don't crash on persist.
function memoryStorage(): StateStorage {
  const m: Record<string, string> = {}
  return {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = v },
    removeItem: (k) => { delete m[k] },
  }
}

const storage = createJSONStorage<{ presets: StylePreset[] }>(() =>
  typeof localStorage !== 'undefined' ? localStorage : memoryStorage(),
)

export const useStylesStore = create<StylesStore>()(
  persist(
    (set) => ({
      presets: [],
      addPreset: (name, text) => {
        const preset: StylePreset = { id: nanoid(), name, text }
        set((s) => ({ presets: [...s.presets, preset] }))
        return preset
      },
      updatePreset: (id, patch) =>
        set((s) => ({ presets: s.presets.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      removePreset: (id) => set((s) => ({ presets: s.presets.filter((p) => p.id !== id) })),
    }),
    { name: 'hip-styles', storage, partialize: (s) => ({ presets: s.presets }) },
  ),
)
