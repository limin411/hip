import { create } from 'zustand'

export type ArtifactTab = 'files' | 'agents' | 'diff'

interface UiState {
  collapsed: boolean
  setCollapsed: (v: boolean) => void
  toggleCollapsed: () => void

  search: string
  setSearch: (q: string) => void

  // Transient scroll target: the messageId of a clicked search hit. ChatPane scrolls
  // to it + briefly highlights it, then clears it. Not persisted.
  scrollTargetMessageId: string | null
  setScrollTarget: (id: string | null) => void

  panelOpen: boolean
  activeTab: ArtifactTab
  setTab: (t: ArtifactTab) => void
  togglePanel: () => void
  setPanelOpen: (v: boolean) => void

  // Settings modal open state, lifted here so any view (e.g. the chat's no-key
  // notice) can open Settings — not just the user menu that hosts the modal.
  settingsOpen: boolean
  setSettingsOpen: (v: boolean) => void

  // Diff view mode: unified (default) or split (side-by-side). In-memory only,
  // resets on refresh — no persist middleware, intentionally matches activeTab style.
  diffViewMode: 'unified' | 'split'
  setDiffViewMode: (m: 'unified' | 'split') => void
}

export const useUiStore = create<UiState>((set) => ({
  collapsed: false,
  setCollapsed: (v) => set((s) => (s.collapsed === v ? s : { collapsed: v })),
  toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed })),

  search: '',
  setSearch: (q) => set({ search: q }),

  scrollTargetMessageId: null,
  setScrollTarget: (id) => set((s) => (s.scrollTargetMessageId === id ? s : { scrollTargetMessageId: id })),

  panelOpen: false,
  activeTab: 'agents',
  setTab: (t) => set({ activeTab: t }),
  togglePanel: () => set((s) => ({
    panelOpen: !s.panelOpen,
  })),
  setPanelOpen: (v) => set((s) =>
    s.panelOpen === v ? s : { panelOpen: v },
  ),

  settingsOpen: false,
  setSettingsOpen: (v) => set((s) => (s.settingsOpen === v ? s : { settingsOpen: v })),

  diffViewMode: 'unified',
  setDiffViewMode: (m) => set({ diffViewMode: m }),
}))
