import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'
import type { CheckpointMode } from '@hip/protocol'

export type ArtifactTab = 'files' | 'agents' | 'timeline' | 'changes' | 'dag' | 'terminal'

export type ActiveView = 'chat' | 'code' | 'settings' | 'history'
export type Surface = 'chat' | 'code'
export type ChatTab = 'files' | 'agents'
export type Theme = 'light' | 'dark' | 'system'

interface UiState {
  settingsNavCollapsed: boolean
  setSettingsNavCollapsed: (v: boolean) => void
  toggleSettingsNav: () => void

  scrollTargetMessageId: string | null
  setScrollTarget: (id: string | null) => void

  // Code surface: ArtifactPanel tabs (files/agents/timeline/changes/dag/terminal).
  activeTab: ArtifactTab
  setTab: (t: ArtifactTab) => void

  // Chat surface: the slim preview/artifacts panel (never includes terminal).
  chatActiveTab: ChatTab
  setChatActiveTab: (v: ChatTab) => void
  resetChatActiveTab: () => void
  selectedArtifactPath: string | null
  setSelectedArtifactPath: (p: string | null) => void

  // Per-surface open conversation. codeSessionId is persisted (Code restores last on launch);
  // chatSessionId is in-memory only (Chat opens new on cold launch — industry norm).
  chatSessionId: string | null
  setChatSessionId: (id: string | null) => void
  codeSessionId: string | null
  setCodeSessionId: (id: string | null) => void

  // Browser-style session tabs in the title bar.
  openSessionIds: string[]
  addOpenSession: (id: string) => void
  removeOpenSession: (id: string) => void
  reorderOpenSessions: (ids: string[]) => void

  activeView: ActiveView
  setActiveView: (v: ActiveView) => void
  previousView: ActiveView | null

  diffViewMode: 'unified' | 'split'
  setDiffViewMode: (m: 'unified' | 'split') => void

  checkpointMode: CheckpointMode
  setCheckpointMode: (m: CheckpointMode) => void

  theme: Theme
  setTheme: (t: Theme) => void
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

const storage = createJSONStorage<{ codeSessionId: string | null; theme: Theme }>(() =>
  typeof localStorage !== 'undefined' ? localStorage : memoryStorage(),
)

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      settingsNavCollapsed: false,
      setSettingsNavCollapsed: (v) =>
        set((s) => (s.settingsNavCollapsed === v ? s : { settingsNavCollapsed: v })),
      toggleSettingsNav: () => set((s) => ({ settingsNavCollapsed: !s.settingsNavCollapsed })),

      scrollTargetMessageId: null,
      setScrollTarget: (id) => set((s) => (s.scrollTargetMessageId === id ? s : { scrollTargetMessageId: id })),

      activeTab: 'agents',
      setTab: (t) => set({ activeTab: t }),

      chatActiveTab: 'files',
      setChatActiveTab: (v) => set((s) => (s.chatActiveTab === v ? s : { chatActiveTab: v })),
      resetChatActiveTab: () => set((s) => (s.chatActiveTab === 'files' ? s : { chatActiveTab: 'files' })),
      selectedArtifactPath: null,
      setSelectedArtifactPath: (p) => set((s) => (s.selectedArtifactPath === p ? s : { selectedArtifactPath: p })),

      chatSessionId: null,
      setChatSessionId: (id) => set((s) => (s.chatSessionId === id ? s : { chatSessionId: id })),
      codeSessionId: null,
      setCodeSessionId: (id) => set((s) => (s.codeSessionId === id ? s : { codeSessionId: id })),

      openSessionIds: [],
      addOpenSession: (id) =>
        set((s) => {
          const without = s.openSessionIds.filter((x) => x !== id)
          return { openSessionIds: [id, ...without] }
        }),
      removeOpenSession: (id) =>
        set((s) => ({ openSessionIds: s.openSessionIds.filter((x) => x !== id) })),
      reorderOpenSessions: (ids) => set({ openSessionIds: ids }),

      activeView: 'chat',
      previousView: null,
      setActiveView: (v) =>
        set((s) => {
          if (s.activeView === v) return s
          const isSpecial = (view: ActiveView) => view === 'settings' || view === 'history'
          const enteringSpecial = isSpecial(v) && !isSpecial(s.activeView)
          const leavingSpecial = isSpecial(s.activeView) && !isSpecial(v)
          return {
            activeView: v,
            previousView: enteringSpecial ? s.activeView : leavingSpecial ? null : s.previousView,
          }
        }),

      diffViewMode: 'unified',
      setDiffViewMode: (m) => set({ diffViewMode: m }),

      checkpointMode: 'this-turn',
      setCheckpointMode: (m) => set({ checkpointMode: m }),

      theme: 'system',
      setTheme: (t) => set((s) => (s.theme === t ? s : { theme: t })),
    }),
    { name: 'hip-ui', storage, partialize: (s) => ({ codeSessionId: s.codeSessionId, theme: s.theme }) },
  ),
)
