import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'
import type { CheckpointMode } from '@hip/protocol'
// Lazy helpers used only inside closeKnowledgeView to avoid circular init issues
// are imported dynamically in that method.

export type ArtifactTab = 'files' | 'agents' | 'outline' | 'timeline' | 'changes' | 'terminal'

export type ActiveView = 'chat' | 'code' | 'settings' | 'history' | 'knowledge'
export type Surface = 'chat' | 'code'
export type ChatTab = 'files' | 'agents' | 'outline'
export type Theme = 'light' | 'dark' | 'system'
export type AppLanguage = 'zh-CN' | 'zh-TW' | 'en'
export type UiDensity = 'comfortable' | 'compact'
/** Left sidebar primary section (memory-only; cold launch always 'chats'). */
export type SidebarSection = 'knowledge' | 'projects' | 'chats'

/** Settings panel left-nav page ids (see SettingsPanel PAGES). */
export type SettingsPageId =
  | 'general'
  | 'model'
  | 'agents'
  | 'mcp'
  | 'skill'
  | 'plugins'
  | 'hooks'
  | 'memory'

const SETTINGS_PAGE_IDS: readonly SettingsPageId[] = [
  'general',
  'model',
  'agents',
  'mcp',
  'skill',
  'plugins',
  'hooks',
  'memory',
]

function normalizeSettingsPage(v: unknown): SettingsPageId {
  if (typeof v === 'string' && (SETTINGS_PAGE_IDS as readonly string[]).includes(v)) {
    return v as SettingsPageId
  }
  return 'general'
}

const APP_LANGUAGES: readonly AppLanguage[] = ['zh-CN', 'zh-TW', 'en']
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

/** Resolve a stored / browser language tag to one of the three app locales. */
export function normalizeAppLanguage(raw: string | null | undefined): AppLanguage | null {
  if (!raw) return null
  if (isAppLanguage(raw)) return raw
  if (raw.startsWith('zh-TW') || raw.startsWith('zh-HK') || raw === 'zh-Hant') return 'zh-TW'
  if (raw.startsWith('zh')) return 'zh-CN'
  if (raw.startsWith('en')) return 'en'
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
  // activeView is intentionally NOT persisted — cold launch always New Conversation (chat).
  theme: Theme
  language: AppLanguage
  density: UiDensity
  settingsPage: SettingsPageId
  diffViewMode: 'unified' | 'split'
  checkpointMode: CheckpointMode
  /** Left nav rail open; default true when missing from older storage. */
  sidebarOpen: boolean
}

/** Settings / history / knowledge are session-ephemeral; cold launch always lands on chat. */
export function isEphemeralActiveView(v: ActiveView): boolean {
  return v === 'settings' || v === 'history' || v === 'knowledge'
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
    // Always cold-start on chat New Conversation (product rule).
    activeView: 'chat' as const,
    sidebarSection: 'chats' as const,
    density: normalizeUiDensity((rest as { density?: unknown }).density),
    // Drop removed pages (e.g. legacy 'help') so tabs stay valid.
    settingsPage: normalizeSettingsPage((rest as { settingsPage?: unknown }).settingsPage),
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

  /** Left sidebar section highlight (not persisted; cold launch 'chats'). */
  sidebarSection: SidebarSection
  setSidebarSection: (s: SidebarSection) => void

  /** Left nav rail visible (persisted). */
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void

  openKnowledgeView: () => void
  /** Flush knowledge draft then restore chat/code from domain active session. */
  closeKnowledgeView: () => Promise<void>

  /**
   * Knowledge surface right-rail open (AppLayout drawer). Ephemeral — not persisted.
   * Default true so the doc outline is visible when entering a space (discoverable).
   */
  knowledgePanelOpen: boolean
  setKnowledgePanelOpen: (open: boolean) => void

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

      sidebarSection: 'chats',
      setSidebarSection: (sec) =>
        set((s) => (s.sidebarSection === sec ? s : { sidebarSection: sec })),

      sidebarOpen: true,
      setSidebarOpen: (open) =>
        set((s) => (s.sidebarOpen === open ? s : { sidebarOpen: open })),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

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
 * Cold launch shell: New Conversation on chat surface.
 * Safe to call after rehydrate and once from AppLayout.
 */
export function applyColdLaunchShell(): void {
  useUiStore.setState({ activeView: 'chat', sidebarSection: 'chats' })
}
