import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'
import type { CheckpointMode } from '@hip/protocol'

export type ArtifactTab = 'files' | 'agents' | 'timeline' | 'changes' | 'terminal'

export type ActiveView = 'chat' | 'code' | 'settings' | 'history'
export type Surface = 'chat' | 'code'
export type ChatTab = 'files' | 'agents'
export type Theme = 'light' | 'dark' | 'system'
export type AppLanguage = 'zh-CN' | 'zh-TW' | 'en'

/** Settings panel left-nav page ids (see SettingsPanel PAGES). */
export type SettingsPageId = 'general' | 'model' | 'agents' | 'mcp' | 'skill' | 'plugins' | 'hooks' | 'memory'

const APP_LANGUAGES: readonly AppLanguage[] = ['zh-CN', 'zh-TW', 'en']

function isAppLanguage(v: unknown): v is AppLanguage {
  return typeof v === 'string' && (APP_LANGUAGES as readonly string[]).includes(v)
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
  openSessionIds: string[]
  chatSessionId: string | null
  codeSessionId: string | null
  activeView: ActiveView
  theme: Theme
  language: AppLanguage
  settingsPage: SettingsPageId
  settingsNavCollapsed: boolean
  diffViewMode: 'unified' | 'split'
  checkpointMode: CheckpointMode
}

interface UiState {
  settingsNavCollapsed: boolean
  setSettingsNavCollapsed: (v: boolean) => void
  toggleSettingsNav: () => void

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

  // Per-surface open conversation (persisted; restored with openSessionIds on launch).
  chatSessionId: string | null
  setChatSessionId: (id: string | null) => void
  codeSessionId: string | null
  setCodeSessionId: (id: string | null) => void

  // Browser-style session tabs in the title bar (persisted; pruned against session:list on ready).
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

  language: AppLanguage
  setLanguage: (l: AppLanguage) => void
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
      settingsNavCollapsed: false,
      setSettingsNavCollapsed: (v) =>
        set((s) => (s.settingsNavCollapsed === v ? s : { settingsNavCollapsed: v })),
      toggleSettingsNav: () => set((s) => ({ settingsNavCollapsed: !s.settingsNavCollapsed })),

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

      language: seedLanguage(),
      setLanguage: (l) => set((s) => (s.language === l ? s : { language: l })),
    }),
    {
      name: 'hip-ui',
      storage,
      partialize: (s): UiPersistedState => ({
        openSessionIds: s.openSessionIds,
        chatSessionId: s.chatSessionId,
        codeSessionId: s.codeSessionId,
        activeView: s.activeView,
        theme: s.theme,
        language: s.language,
        settingsPage: s.settingsPage,
        settingsNavCollapsed: s.settingsNavCollapsed,
        diffViewMode: s.diffViewMode,
        checkpointMode: s.checkpointMode,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return
        // Clamp language from older / partial storage (i18n sync is owned by LanguageProvider).
        const lang = isAppLanguage(state.language) ? state.language : seedLanguage()
        if (state.language !== lang) {
          useUiStore.setState({ language: lang })
        }
      },
    },
  ),
)
