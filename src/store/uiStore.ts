import { create } from 'zustand'

export type ArtifactTab = 'doc' | 'files' | 'agents' | 'diff'

interface UiState {
  collapsed: boolean
  setCollapsed: (v: boolean) => void
  toggleCollapsed: () => void

  search: string
  setSearch: (q: string) => void

  panelOpen: boolean
  activeTab: ArtifactTab
  setTab: (t: ArtifactTab) => void
  togglePanel: () => void
  setPanelOpen: (v: boolean) => void
}

export const useUiStore = create<UiState>((set) => ({
  collapsed: false,
  setCollapsed: (v) => set((s) => (s.collapsed === v ? s : { collapsed: v })),
  toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed })),

  search: '',
  setSearch: (q) => set({ search: q }),

  panelOpen: false,
  activeTab: 'agents',
  setTab: (t) => set({ activeTab: t }),
  togglePanel: () => set((s) => ({
    panelOpen: !s.panelOpen,
  })),
  setPanelOpen: (v) => set((s) =>
    s.panelOpen === v ? s : { panelOpen: v },
  ),
}))
