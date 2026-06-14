import { create } from 'zustand'
import type { CheckpointMode } from '@hip/protocol'

export type ArtifactTab = 'files' | 'agents' | 'timeline' | 'changes'

export type ActiveView = 'chat' | 'settings'

interface UiState {
  // 对话列表（会话侧栏）折叠态
  collapsed: boolean
  setCollapsed: (v: boolean) => void
  toggleCollapsed: () => void

  // 设置页分类侧栏折叠态 —— 与 collapsed 同构，便于标题栏的统一折叠按钮按当前视图分派
  settingsNavCollapsed: boolean
  setSettingsNavCollapsed: (v: boolean) => void
  toggleSettingsNav: () => void

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

  // 主视图：对话区（三栏）或设置独立页。视图状态驱动，不走路由。
  activeView: ActiveView
  setActiveView: (v: ActiveView) => void

  // Diff view mode: unified (default) or split (side-by-side). In-memory only,
  // resets on refresh — no persist middleware, intentionally matches activeTab style.
  diffViewMode: 'unified' | 'split'
  setDiffViewMode: (m: 'unified' | 'split') => void

  // Timeline checkpoint diff mode (本轮/自此至今/起点至今). In-memory only, like diffViewMode.
  checkpointMode: CheckpointMode
  setCheckpointMode: (m: CheckpointMode) => void
}

export const useUiStore = create<UiState>((set) => ({
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
  togglePanel: () => set((s) => ({
    panelOpen: !s.panelOpen,
  })),
  setPanelOpen: (v) => set((s) =>
    s.panelOpen === v ? s : { panelOpen: v },
  ),

  activeView: 'chat',
  setActiveView: (v) => set((s) => (s.activeView === v ? s : { activeView: v })),

  diffViewMode: 'unified',
  setDiffViewMode: (m) => set({ diffViewMode: m }),

  checkpointMode: 'this-turn',
  setCheckpointMode: (m) => set({ checkpointMode: m }),
}))
