import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'
import type { CheckpointMode } from '@hip/protocol'
import { TERMINAL_MANAGEMENT } from '@/components/terminals/feature'
import { WORK_ITEM_TRACKING } from '@/components/work-items/feature'
import {
  clampSidebarWidth,
  SIDEBAR_WIDTH_DEFAULT,
} from '@/components/layout/sidebarWidth'
// Lazy helpers used only inside closeKnowledgeView to avoid circular init issues
// are imported dynamically in that method.

export type ArtifactTab = 'files' | 'agents' | 'tasks' | 'outline' | 'timeline' | 'changes' | 'terminal'

export type ActiveView =
  | 'workbench'
  | 'chat'
  | 'code'
  | 'settings'
  | 'history'
  | 'notifications'
  | 'knowledge'
  | 'trash'
  | 'terminals'
  | 'tasks'
  | 'automation'
export type Surface = 'chat' | 'code'
export type ChatTab = 'files' | 'agents' | 'tasks' | 'outline' | 'sources'
export type Theme = 'light' | 'dark' | 'system'
export type AppLanguage = 'zh-CN' | 'zh-TW' | 'en' | 'ja' | 'ko'
export type UiDensity = 'comfortable' | 'compact'
/** Left sidebar primary section (memory-only; cold launch always 'workbench'). */
export type SidebarSection =
  | 'workbench'
  | 'knowledge'
  | 'projects'
  | 'chats'
  | 'terminals'
  | 'tasks'
  | 'automation'

/**
 * Primary nav sections that only show a "coming soon" placeholder page.
 * When TERMINAL_MANAGEMENT is on, `terminals` is a real section (not placeholder) — K14.
 * When WORK_ITEM_TRACKING is on, `tasks` is a real section (not placeholder).
 */
export type PlaceholderSidebarSection =
  | 'workbench'
  | 'automation'
  | (typeof TERMINAL_MANAGEMENT extends true ? never : 'terminals')
  | (typeof WORK_ITEM_TRACKING extends true ? never : 'tasks')

export function isPlaceholderSidebarSection(s: SidebarSection): s is PlaceholderSidebarSection {
  if (s === 'terminals') return !TERMINAL_MANAGEMENT
  if (s === 'tasks') return !WORK_ITEM_TRACKING
  return s === 'workbench' || s === 'automation'
}

/** Settings panel left-nav page ids (see SettingsPanel PAGES). */
export type SettingsPageId =
  | 'general'
  | 'voice'
  | 'window'
  | 'model'
  | 'connectors'
  | 'memory'
  | 'agents'
  | 'mcp'
  | 'skill'
  | 'plugins'
  | 'hooks'

/** Order matches SettingsPanel NAV_GROUPS (basics → agents). */
const SETTINGS_PAGE_IDS: readonly SettingsPageId[] = [
  'general',
  'voice',
  'window',
  'model',
  'connectors',
  'memory',
  'agents',
  'mcp',
  'skill',
  'plugins',
  'hooks',
]

function normalizeSettingsPage(v: unknown): SettingsPageId {
  if (typeof v === 'string' && (SETTINGS_PAGE_IDS as readonly string[]).includes(v)) {
    return v as SettingsPageId
  }
  return 'general'
}

const APP_LANGUAGES: readonly AppLanguage[] = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko']
const UI_DENSITIES: readonly UiDensity[] = ['comfortable', 'compact']

function isAppLanguage(v: unknown): v is AppLanguage {
  return typeof v === 'string' && (APP_LANGUAGES as readonly string[]).includes(v)
}

export function isUiDensity(v: unknown): v is UiDensity {
  return typeof v === 'string' && (UI_DENSITIES as readonly string[]).includes(v)
}

/** Invalid / missing → comfortable (FOUC-safe default). */
export function normalizeUiDensity(raw: unknown): UiDensity {
  return isUiDensity(raw) ? raw : 'comfortable'
}

/** Resolve a stored / browser language tag to one of the app locales. */
export function normalizeAppLanguage(raw: string | null | undefined): AppLanguage | null {
  if (!raw) return null
  if (isAppLanguage(raw)) return raw
  if (raw.startsWith('zh-TW') || raw.startsWith('zh-HK') || raw === 'zh-Hant') return 'zh-TW'
  if (raw.startsWith('zh')) return 'zh-CN'
  if (raw.startsWith('en')) return 'en'
  if (raw === 'ja' || raw.startsWith('ja-') || raw.startsWith('ja_')) return 'ja'
  if (raw === 'ko' || raw.startsWith('ko-') || raw.startsWith('ko_')) return 'ko'
  return null
}

/** Seed language before rehydrate: prefer i18next cache, then navigator, then zh-CN. */
function seedLanguage(): AppLanguage {
  if (typeof localStorage !== 'undefined') {
    try {
      const fromI18n = normalizeAppLanguage(localStorage.getItem('i18nextLng'))
      if (fromI18n) return fromI18n
    } catch {
      // ignore
    }
  }
  if (typeof navigator !== 'undefined') {
    const fromNav = normalizeAppLanguage(navigator.language)
    if (fromNav) return fromNav
  }
  return 'zh-CN'
}

/** Slice of uiStore written to localStorage under `hip-ui`. */
export type UiPersistedState = {
  chatSessionId: string | null
  codeSessionId: string | null
  // activeView is intentionally NOT persisted — cold launch always Workbench.
  theme: Theme
  language: AppLanguage
  density: UiDensity
  settingsPage: SettingsPageId
  diffViewMode: 'unified' | 'split'
  checkpointMode: CheckpointMode
  /** Left nav rail open; default true when missing from older storage. */
  sidebarOpen: boolean
  /** Left sidebar width in px; clamped on write / rehydrate. */
  sidebarWidth: number
}

/** Special / placeholder views are session-ephemeral; cold launch always lands on workbench. */
export function isEphemeralActiveView(v: ActiveView): boolean {
  return (
    v === 'settings' ||
    v === 'history' ||
    v === 'notifications' ||
    v === 'trash' ||
    v === 'knowledge' ||
    v === 'workbench' ||
    v === 'terminals' ||
    v === 'tasks' ||
    v === 'automation'
  )
}

/** Merge hip-ui storage into runtime state; strip legacy shell fields. */
export function mergeUiPersistedState<
  S extends { activeView: ActiveView; sidebarSection: SidebarSection },
>(persistedState: unknown, currentState: S): S {
  const p = (persistedState ?? {}) as Partial<UiPersistedState> & {
    activeView?: ActiveView
    knowledgeTabOpen?: boolean
    sidebarSection?: SidebarSection
    openSessionIds?: string[]
    settingsNavCollapsed?: boolean
  }
  // Drop legacy / non-persisted fields that must not rehydrate into shell state.
  const {
    activeView: _legacyView,
    knowledgeTabOpen: _legacyKb,
    sidebarSection: _legacySection,
    openSessionIds: _legacyTabs,
    settingsNavCollapsed: _legacySettingsNav,
    ...rest
  } = p
  return {
    ...currentState,
    ...rest,
    // Always cold-start on Workbench (product rule).
    activeView: 'workbench' as const,
    sidebarSection: 'workbench' as const,
    density: normalizeUiDensity((rest as { density?: unknown }).density),
    // Drop removed pages (e.g. legacy 'help') so tabs stay valid.
    settingsPage: normalizeSettingsPage((rest as { settingsPage?: unknown }).settingsPage),
    sidebarWidth: clampSidebarWidth((rest as { sidebarWidth?: unknown }).sidebarWidth),
  }
}

interface UiState {
  /** Which settings category is selected (also used by /memory slash command). */
  settingsPage: SettingsPageId
  setSettingsPage: (page: SettingsPageId) => void

  scrollTargetMessageId: string | null
  setScrollTarget: (id: string | null) => void

  // Code surface: ArtifactPanel tabs (files/agents/timeline/changes/terminal).
  activeTab: ArtifactTab
  setTab: (t: ArtifactTab) => void

  // Chat surface: the slim preview/artifacts panel (never includes terminal).
  chatActiveTab: ChatTab
  setChatActiveTab: (v: ChatTab) => void
  resetChatActiveTab: () => void
  selectedArtifactPath: string | null
  setSelectedArtifactPath: (p: string | null) => void

  // Per-surface last conversation (persisted for mid-session chat/code switching; not auto-selected on launch).
  chatSessionId: string | null
  setChatSessionId: (id: string | null) => void
  codeSessionId: string | null
  setCodeSessionId: (id: string | null) => void

  activeView: ActiveView
  setActiveView: (v: ActiveView) => void
  previousView: ActiveView | null

  /** Left sidebar section highlight (not persisted; cold launch 'workbench'). */
  sidebarSection: SidebarSection
  setSidebarSection: (s: SidebarSection) => void

  /** Left nav rail visible (persisted). */
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void

  /** Left sidebar width in px (persisted; clamped). */
  sidebarWidth: number
  setSidebarWidth: (width: number) => void

  openKnowledgeView: () => void
  /** Flush knowledge draft then restore chat/code from domain active session. */
  closeKnowledgeView: () => Promise<void>

  /**
   * Knowledge surface right-rail open (AppLayout drawer). Ephemeral — not persisted.
   * Default true so the doc outline is visible when entering a space (discoverable).
   */
  knowledgePanelOpen: boolean
  setKnowledgePanelOpen: (open: boolean) => void

  /**
   * Terminal-management right-rail (files tree) open (AppLayout drawer).
   * Ephemeral — not persisted. Default true when a managed session is focused.
   * Hidden automatically when no terminal is focused (HostLibrary landing).
   */
  terminalPanelOpen: boolean
  setTerminalPanelOpen: (open: boolean) => void

  diffViewMode: 'unified' | 'split'
  setDiffViewMode: (m: 'unified' | 'split') => void

  checkpointMode: CheckpointMode
  setCheckpointMode: (m: CheckpointMode) => void

  theme: Theme
  setTheme: (t: Theme) => void

  language: AppLanguage
  setLanguage: (l: AppLanguage) => void

  density: UiDensity
  setDensity: (d: UiDensity) => void
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

const storage = createJSONStorage<UiPersistedState>(() =>
  typeof localStorage !== 'undefined' ? localStorage : memoryStorage(),
)

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      settingsPage: 'general',
      setSettingsPage: (page) =>
        set((s) => (s.settingsPage === page ? s : { settingsPage: page })),

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

      activeView: 'workbench',
      previousView: null,
      setActiveView: (v) =>
        set((s) => {
          if (s.activeView === v) return s
          const isSpecial = (view: ActiveView) =>
            view === 'settings' ||
            view === 'history' ||
            view === 'notifications' ||
            view === 'trash'
          const enteringSpecial = isSpecial(v) && !isSpecial(s.activeView)
          const leavingSpecial = isSpecial(s.activeView) && !isSpecial(v)
          return {
            activeView: v,
            previousView: enteringSpecial ? s.activeView : leavingSpecial ? null : s.previousView,
          }
        }),

      sidebarSection: 'workbench',
      setSidebarSection: (sec) =>
        set((s) => (s.sidebarSection === sec ? s : { sidebarSection: sec })),

      sidebarOpen: true,
      setSidebarOpen: (open) =>
        set((s) => (s.sidebarOpen === open ? s : { sidebarOpen: open })),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

      sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
      setSidebarWidth: (width) =>
        set((s) => {
          const next = clampSidebarWidth(width)
          return s.sidebarWidth === next ? s : { sidebarWidth: next }
        }),

      openKnowledgeView: () => set({ activeView: 'knowledge' }),
      closeKnowledgeView: async () => {
        // Tier A: await draft flush before leaving.
        try {
          const { useKnowledgeStore } = await import('@/store/knowledgeStore')
          await useKnowledgeStore.getState().flushSave()
        } catch {
          // ignore — non-Tauri / not loaded
        }
        const { useDomainStore } = await import('@/domain')
        const { surfaceOf } = await import('@/lib/sessions')
        const active = useDomainStore.getState().sessions.find(
          (s) => s.id === useDomainStore.getState().activeSessionId,
        )
        const surface = active ? surfaceOf(active.config) : 'chat'
        set({
          activeView: surface === 'code' ? 'code' : 'chat',
          sidebarSection: surface === 'code' ? 'projects' : 'chats',
        })
      },

      knowledgePanelOpen: true,
      setKnowledgePanelOpen: (open) =>
        set((s) => (s.knowledgePanelOpen === open ? s : { knowledgePanelOpen: open })),

      terminalPanelOpen: true,
      setTerminalPanelOpen: (open) =>
        set((s) => (s.terminalPanelOpen === open ? s : { terminalPanelOpen: open })),

      diffViewMode: 'unified',
      setDiffViewMode: (m) => set({ diffViewMode: m }),

      checkpointMode: 'this-turn',
      setCheckpointMode: (m) => set({ checkpointMode: m }),

      theme: 'system',
      setTheme: (t) => set((s) => (s.theme === t ? s : { theme: t })),

      language: seedLanguage(),
      setLanguage: (l) => set((s) => (s.language === l ? s : { language: l })),

      density: 'comfortable',
      setDensity: (d) => set((s) => (s.density === d ? s : { density: d })),
    }),
    {
      name: 'hip-ui',
      storage,
      partialize: (s): UiPersistedState => ({
        chatSessionId: s.chatSessionId,
        codeSessionId: s.codeSessionId,
        // Never persist activeView — verified on device that hip-ui still held
        // activeView:"knowledge" and reopened the KB shell after restart.
        theme: s.theme,
        language: s.language,
        density: s.density,
        settingsPage: s.settingsPage,
        diffViewMode: s.diffViewMode,
        checkpointMode: s.checkpointMode,
        sidebarOpen: s.sidebarOpen,
        sidebarWidth: s.sidebarWidth,
      }),
      merge: (persistedState, currentState) =>
        mergeUiPersistedState(persistedState, currentState as UiState),
      onRehydrateStorage: () => (state, error) => {
        if (error || !state) return
        // IMPORTANT: persist rehydrate often completes *synchronously* during
        // `create()`, while `useUiStore` is still in the temporal dead zone.
        // Calling useUiStore.setState here throws, aborts the hydrate chain.
        // Defer any setState to a microtask (after the export binding exists).
        const language = state.language
        const density = state.density
        queueMicrotask(() => {
          const lang = isAppLanguage(language) ? language : seedLanguage()
          const dens = normalizeUiDensity(density)
          const patch: Partial<UiState> = {}
          if (useUiStore.getState().language !== lang) patch.language = lang
          if (useUiStore.getState().density !== dens) patch.density = dens
          if (Object.keys(patch).length > 0) useUiStore.setState(patch)
          applyColdLaunchShell()
        })
      },
    },
  ),
)

/**
 * Cold launch shell: Workbench placeholder (default home).
 * Safe to call after rehydrate and once from AppLayout.
 * Nav history is seeded separately from AppLayout (see seedNavHistoryIfEmpty).
 */
export function applyColdLaunchShell(): void {
  useUiStore.setState({ activeView: 'workbench', sidebarSection: 'workbench' })
}
