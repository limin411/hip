import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'
import { nanoid } from 'nanoid'
import type { PermissionMode } from '@hip/protocol'
import type { Surface } from './uiStore'
import { clampEffortForKey } from '@/lib/modelEffort'
import { useProvidersStore } from '@/store/providersStore'

export interface Draft {
  tempId: string
  mode: 'project' | 'chat'
  cwd?: string
  text: string
  agentId?: string             // primary agent for new sessions: undefined|'builtin' = hip; else ACP agent id
  modelKey?: string            // 'providerID/modelID' chosen for this chat
  permissionMode?: PermissionMode   // 'chat'|'edit'|'full' chosen for this chat; undefined ⇒ server default 'edit'
  /** When true, first committed code session forces plan mode (EnterPlanMode path). */
  forcePlan?: boolean
  /** Reasoning effort level when the model supports it. */
  effort?: string
}

interface DraftStore {
  draft: Draft | null
  ensureDraft: (surface?: Surface) => Draft
  setText: (text: string) => void
  pickProject: (cwd: string) => void
  clearProject: () => void
  setAgentId: (agentId: string) => void
  setModelKey: (modelKey: string) => void
  setPermissionMode: (permissionMode: PermissionMode) => void
  setForcePlan: (forcePlan: boolean) => void
  setEffort: (effort: string | undefined) => void
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
          // Drop or remapped effort so draft does not carry Anthropic `max` onto OpenAI, etc.
          const catalog = useProvidersStore.getState().catalog
          const effort = clampEffortForKey(catalog, modelKey, base.effort)
          return { draft: { ...base, modelKey, effort } }
        }),
      setPermissionMode: (permissionMode) =>
        set((s) => {
          const base: Draft = s.draft ?? { tempId: nanoid(), mode: 'chat', text: '' }
          return { draft: { ...base, permissionMode } }
        }),
      setForcePlan: (forcePlan) =>
        set((s) => {
          const base: Draft = s.draft ?? { tempId: nanoid(), mode: 'chat', text: '' }
          return { draft: { ...base, forcePlan } }
        }),
      setEffort: (effort) =>
        set((s) => {
          const base: Draft = s.draft ?? { tempId: nanoid(), mode: 'chat', text: '' }
          return { draft: { ...base, effort: effort || undefined } }
        }),
      reset: () => set({ draft: null }),
    }),
    { name: 'hip-draft', storage, partialize: (s) => ({ draft: s.draft }) },
  ),
)
