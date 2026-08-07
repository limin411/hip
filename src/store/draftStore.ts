import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'
import { nanoid } from 'nanoid'
import type { PermissionMode, ExecutionMode } from '@hip/protocol'
import {
  canSelectAutopilot,
  executionModeConfigPatch,
  resolveExecutionMode,
} from '@hip/protocol'
import type { Surface } from './uiStore'
import { clampEffortForKey } from '@/lib/modelEffort'
// store-dep(read-only): draft reads active model to build a sendable SessionConfig
import { useProvidersStore } from '@/store/providersStore'

export interface Draft {
  tempId: string
  mode: 'project' | 'chat'
  cwd?: string
  text: string
  agentId?: string             // primary agent for new sessions: undefined|'builtin' = hip; else ACP agent id
  modelKey?: string            // 'providerID/modelID' chosen for this chat
  permissionMode?: PermissionMode   // 'chat'|'edit'|'full' chosen for this chat; undefined ⇒ server default 'edit'
  /** Collaboration mode; dual-written with forcePlan. Autopilot requires full. */
  executionMode?: ExecutionMode
  /** When true, first committed code session forces plan mode (EnterPlanMode path). */
  forcePlan?: boolean
  /** Reasoning effort level when the model supports it. */
  effort?: string
  /**
   * Chat empty-state one-shot: first message gets roundtable framing.
   * Cleared on draft reset after session commit. Ignored for project/code drafts.
   * Mode radio group: mutually exclusive with controlPermission.
   */
  roundtable?: boolean
  /**
   * Chat empty-state one-shot: grants full machine access (permissionMode 'full')
   * for the committed chat session — high-risk. Cleared on draft reset after
   * session commit. Ignored for project/code drafts.
   * Mode radio group: mutually exclusive with roundtable.
   */
  controlPermission?: boolean
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
  setExecutionMode: (executionMode: ExecutionMode) => boolean
  setEffort: (effort: string | undefined) => void
  setRoundtable: (roundtable: boolean) => void
  setControlPermission: (controlPermission: boolean) => void
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
          // builtin / empty → clear field (undefined = hip). External → drop hip-only controls.
          const id = typeof agentId === 'string' ? agentId.trim() : ''
          if (!id || id === 'builtin') {
            const { agentId: _a, ...rest } = base
            return { draft: rest }
          }
          const { forcePlan: _f, executionMode: _em, modelKey: _m, effort: _e, ...rest } = base
          return { draft: { ...rest, agentId: id } }
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
          const next: Draft = { ...base, permissionMode }
          // Leaving full clears autopilot (spec §4.0b).
          if (permissionMode !== 'full' && resolveExecutionMode(base) === 'autopilot') {
            next.executionMode = 'interactive'
            next.forcePlan = false
          }
          return { draft: next }
        }),
      setForcePlan: (forcePlan) =>
        set((s) => {
          const base: Draft = s.draft ?? { tempId: nanoid(), mode: 'chat', text: '' }
          if (forcePlan) {
            return { draft: { ...base, forcePlan: true, executionMode: 'plan' } }
          }
          const keepAuto =
            resolveExecutionMode(base) === 'autopilot' || base.executionMode === 'autopilot'
          return {
            draft: {
              ...base,
              forcePlan: false,
              executionMode: keepAuto && canSelectAutopilot(base.permissionMode) ? 'autopilot' : 'interactive',
            },
          }
        }),
      setExecutionMode: (executionMode) => {
        const base: Draft = get().draft ?? { tempId: nanoid(), mode: 'chat', text: '' }
        if (executionMode === 'autopilot' && !canSelectAutopilot(base.permissionMode)) {
          return false
        }
        const patch = executionModeConfigPatch(executionMode)
        set({ draft: { ...base, ...patch } })
        return true
      },
      setEffort: (effort) =>
        set((s) => {
          const base: Draft = s.draft ?? { tempId: nanoid(), mode: 'chat', text: '' }
          return { draft: { ...base, effort: effort || undefined } }
        }),
      setRoundtable: (roundtable) =>
        set((s) => {
          const base: Draft = s.draft ?? { tempId: nanoid(), mode: 'chat', text: '' }
          if (!roundtable) {
            if (!base.roundtable) return s
            const { roundtable: _r, ...rest } = base
            return { draft: rest }
          }
          // Chat-only product surface; keep flag off project drafts.
          if (base.mode === 'project') {
            return { draft: { ...base, roundtable: undefined } }
          }
          // Mode radio group: arming roundtable clears controlPermission.
          const { controlPermission: _c, ...rest } = base
          return { draft: { ...rest, roundtable: true } }
        }),
      setControlPermission: (controlPermission) =>
        set((s) => {
          const base: Draft = s.draft ?? { tempId: nanoid(), mode: 'chat', text: '' }
          if (!controlPermission) {
            if (!base.controlPermission) return s
            const { controlPermission: _c, ...rest } = base
            return { draft: rest }
          }
          // Chat-only product surface; keep flag off project drafts.
          if (base.mode === 'project') {
            return { draft: { ...base, controlPermission: undefined } }
          }
          // Mode radio group: arming controlPermission clears roundtable.
          const { roundtable: _r, ...rest } = base
          return { draft: { ...rest, controlPermission: true } }
        }),
      reset: () => set({ draft: null }),
    }),
    { name: 'hip-draft', storage, partialize: (s) => ({ draft: s.draft }) },
  ),
)
