import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'
import type { CheckpointMode } from '@hip/protocol'

export type ArtifactTab = 'files' | 'agents' | 'timeline' | 'changes'

export type ActiveView = 'chat' | 'code' | 'settings'
export type ChatTab = 'files' | 'agents'
export type Theme = 'light' | 'dark' | 'system'

interface UiState {
  collapsed: boolean
  setCollapsed: (v: boolean) => void
  toggleCollapsed: () => void

  settingsNavCollapsed: boolean
  setSettingsNavCollapsed: (v: boolean) => void
  toggleSettingsNav: () => void

  search: string
  setSearch: (q: string) => void

  scrollTargetMessageId: string | null
  setScrollTarget: (id: string | null) => void

  // Code surface: the four-tab ArtifactPanel.
  panelOpen: boolean
  activeTab: ArtifactTab
  setTab: (t: ArtifactTab) => void
  togglePanel: () => void
  setPanelOpen: (v: boolean) => void

  // Chat surface: the slim preview/artifacts panel.
  chatPanelOpen: boolean
  toggleChatPanel: () => void
  setChatPanelOpen: (v: boolean) => void
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

  activeView: ActiveView
  setActiveView: (v: ActiveView) => void

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
      collapsed: false,
      setCollapsed: (v) => set((s) => (s.collapsed === v ? s : { collapsed: v })),
      toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed })),

      settingsNavCollapsed: false,
      setSettingsNavCollapsed: (v) =>
        set((s) => (s.settingsNavCollapsed === v ? s : { settingsNavCollapsed: v })),
      toggleSettingsNav: () => set((s) => ({ settingsNavCollapsed: !s.settingsNavCollapsed })),

      search: '',
      setSearch: (q) => set({ search: q }),

      scrollTargetMessageId: null,
      setScrollTarget: (id) => set((s) => (s.scrollTargetMessageId === id ? s : { scrollTargetMessageId: id })),

      panelOpen: false,
      activeTab: 'agents',
      setTab: (t) => set({ activeTab: t }),
      togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
      setPanelOpen: (v) => set((s) => (s.panelOpen === v ? s : { panelOpen: v })),

      chatPanelOpen: false,
      toggleChatPanel: () => set((s) => ({ chatPanelOpen: !s.chatPanelOpen })),
      setChatPanelOpen: (v) => set((s) => (s.chatPanelOpen === v ? s : { chatPanelOpen: v })),
      chatActiveTab: 'files',
      setChatActiveTab: (v) => set((s) => (s.chatActiveTab === v ? s : { chatActiveTab: v })),
      resetChatActiveTab: () => set((s) => (s.chatActiveTab === 'files' ? s : { chatActiveTab: 'files' })),
      selectedArtifactPath: null,
      setSelectedArtifactPath: (p) => set((s) => (s.selectedArtifactPath === p ? s : { selectedArtifactPath: p })),

      chatSessionId: null,
      setChatSessionId: (id) => set((s) => (s.chatSessionId === id ? s : { chatSessionId: id })),
      codeSessionId: null,
      setCodeSessionId: (id) => set((s) => (s.codeSessionId === id ? s : { codeSessionId: id })),

      activeView: 'chat',
      setActiveView: (v) => set((s) => (s.activeView === v ? s : { activeView: v })),

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
