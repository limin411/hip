import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'
import { nanoid } from 'nanoid'

export interface Draft {
  tempId: string
  mode: 'project' | 'chat'
  cwd?: string
  text: string
}

interface DraftStore {
  draft: Draft | null
  ensureDraft: () => Draft
  setText: (text: string) => void
  pickProject: (cwd: string) => void
  clearProject: () => void
  reset: () => void
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

const storage = createJSONStorage<{ draft: Draft | null }>(() =>
  typeof localStorage !== 'undefined' ? localStorage : memoryStorage(),
)

export const useDraftStore = create<DraftStore>()(
  persist(
    (set, get) => ({
      draft: null,
      ensureDraft: () => {
        const cur = get().draft
        if (cur) return cur
        const d: Draft = { tempId: nanoid(), mode: 'chat', text: '' }
        set({ draft: d })
        return d
      },
      setText: (text) => set((s) => (s.draft ? { draft: { ...s.draft, text } } : s)),
      pickProject: (cwd) =>
        set((s) => {
          const base: Draft = s.draft ?? { tempId: nanoid(), mode: 'chat', text: '' }
          return { draft: { ...base, mode: 'project', cwd } }
        }),
      clearProject: () => set((s) => (s.draft ? { draft: { ...s.draft, mode: 'chat', cwd: undefined } } : s)),
      reset: () => set({ draft: null }),
    }),
    { name: 'hip-draft', storage, partialize: (s) => ({ draft: s.draft }) },
  ),
)
