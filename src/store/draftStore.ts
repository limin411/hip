import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'
import { nanoid } from 'nanoid'
import type { PermissionMode } from '@hip/protocol'

export interface Draft {
  tempId: string
  mode: 'project' | 'chat'
  cwd?: string
  text: string
  agentId?: string             // legacy; no longer set by the composer
  modelKey?: string            // 'providerID/modelID' chosen for this chat
  permissionMode?: PermissionMode   // 'chat'|'edit'|'full' chosen for this chat; undefined ⇒ server default 'edit'
}

interface DraftStore {
  draft: Draft | null
  ensureDraft: (surface?: 'chat' | 'code') => Draft
  setText: (text: string) => void
  pickProject: (cwd: string) => void
  clearProject: () => void
  setAgentId: (agentId: string) => void
  setModelKey: (modelKey: string) => void
  setPermissionMode: (permissionMode: PermissionMode) => void
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
      ensureDraft: (surface) => {
        const cur = get().draft
        const mode = surface === 'code' ? 'project' : 'chat'
        if (cur) {
          if (surface && cur.mode !== mode) {
            set({ draft: { ...cur, mode, cwd: mode === 'chat' ? undefined : cur.cwd } })
          }
          return get().draft!
        }
        const d: Draft = { tempId: nanoid(), mode, text: '' }
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
      setAgentId: (agentId) =>
        set((s) => {
          const base: Draft = s.draft ?? { tempId: nanoid(), mode: 'chat', text: '' }
          return { draft: { ...base, agentId } }
        }),
      setModelKey: (modelKey) =>
        set((s) => {
          const base: Draft = s.draft ?? { tempId: nanoid(), mode: 'chat', text: '' }
          return { draft: { ...base, modelKey } }
        }),
      setPermissionMode: (permissionMode) =>
        set((s) => {
          const base: Draft = s.draft ?? { tempId: nanoid(), mode: 'chat', text: '' }
          return { draft: { ...base, permissionMode } }
        }),
      reset: () => set({ draft: null }),
    }),
    { name: 'hip-draft', storage, partialize: (s) => ({ draft: s.draft }) },
  ),
)
