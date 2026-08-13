import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'
import type { AgentConfig, McpServerConfig } from '@hip/protocol'
import { TERMINAL_MANAGEMENT } from '@/components/terminals/feature'
import { WORK_ITEM_TRACKING } from '@/components/work-items/feature'
import { AUTOMATION_PAGE } from '@/components/automation/feature'
import {
  clampSidebarWidth,
  SIDEBAR_WIDTH_DEFAULT,
} from '@/components/layout/sidebarWidth'
// Lazy helpers used only inside closeKnowledgeView to avoid circular init issues
// are imported dynamically in that method.

export type ArtifactTab =
  | 'files'
  | 'outline'
  | 'changes'
  | 'terminal'

/**
 * Ephemeral app mode flags (not persisted).
 * - history / trash: modal shells (OverlayShellHost)
 * - settings: left-rail category nav + main-column body (not a modal)
 */
export type AppOverlay = 'history' | 'trash' | 'settings'

/**
 * Settings overlay L2 route stack (ephemeral — not persisted).
 * `page` = category body; other types replace that body with an in-shell editor
 * (avoids a second centered Task modal over the Settings shell).
 */
export type SettingsShellRoute =
  | { type: 'page' }
  | { type: 'agent-edit'; agentId?: string; kind?: AgentConfig['kind'] }
  | {
      type: 'mcp-edit'
      serverId?: string
      /** Registry install: prefilled draft (no serverId yet). */
      installInitial?: McpServerConfig
    }
  | { type: 'skill-view'; skillId: string }
  | { type: 'plugin-view'; pluginId: string }
  | { type: 'memory-edit'; memoryId?: string }

export const SETTINGS_SHELL_PAGE: SettingsShellRoute = { type: 'page' }

/** Work-surface main column only. History / Trash / Settings use AppOverlay. */
export type ActiveView =
  | 'chat'
  | 'code'
  | 'knowledge'
  | 'terminals'
  | 'tasks'
  | 'automation'
export type Surface = 'chat' | 'code'
/** Managed-terminal right-rail tabs (spec §3.2). */
export type TerminalPanelTab = 'files' | 'agent'
export type ChatTab = 'files' | 'outline' | 'sources'
export type Theme = 'light' | 'dark' | 'system'
export type AppLanguage = 'zh-CN' | 'zh-TW' | 'en' | 'ja' | 'ko'
export type UiDensity = 'comfortable' | 'compact'
/** Left sidebar primary section (memory-only; cold launch always 'chats'). */
export type SidebarSection =
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
 * When AUTOMATION_PAGE is on, `automation` is a real section (not placeholder).
 */
export type PlaceholderSidebarSection =
  | (typeof AUTOMATION_PAGE extends true ? never : 'automation')
  | (typeof TERMINAL_MANAGEMENT extends true ? never : 'terminals')
  | (typeof WORK_ITEM_TRACKING extends true ? never : 'tasks')

export function isPlaceholderSidebarSection(s: SidebarSection): s is PlaceholderSidebarSection {
  if (s === 'terminals') return !TERMINAL_MANAGEMENT
  if (s === 'tasks') return !WORK_ITEM_TRACKING
  if (s === 'automation') return !AUTOMATION_PAGE
  return false
}

/** Settings panel left-nav page ids (see SettingsPanel PAGES). */
export type SettingsPageId =
  | 'general'
  | 'voice'
  | 'window'
  | 'model'
  | 'keyManagement'
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
  'keyManagement',
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

/** Seed language before rehydrate: prefer i18next cache, then navigator, then en. */
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
  // 英文优先：无法识别时冷启动默认为英文（历史为 zh-CN）
  return 'en'
}

/** Slice of uiStore written to localStorage under `hip-ui`. */
export type UiPersistedState = {
  chatSessionId: string | null
  codeSessionId: string | null
  // activeView is intentionally NOT persisted — cold launch always Chats.
  theme: Theme
  language: AppLanguage
  density: UiDensity
  settingsPage: SettingsPageId
  diffViewMode: 'unified' | 'split'
  /** Ignore whitespace-only changes in the Changes diff (git -w). */
  ignoreWhitespace: boolean
  /** Left nav rail open; default true when missing from older storage. */
  sidebarOpen: boolean
  /** Left sidebar width in px; clamped on write / rehydrate. */
  sidebarWidth: number
}

/** Non-chat/code work surfaces are session-ephemeral; cold launch always lands on chats. */
export function isEphemeralActiveView(v: ActiveView): boolean {
  return (
    v === 'knowledge' ||
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
    checkpointMode?: unknown
  }
  // Drop legacy / non-persisted fields that must not rehydrate into shell state.
  const {
    activeView: _legacyView,
    knowledgeTabOpen: _legacyKb,
    sidebarSection: _legacySection,
    openSessionIds: _legacyTabs,
    settingsNavCollapsed: _legacySettingsNav,
    checkpointMode: _legacyCheckpointMode,
    workbenchShowScene: _legacyWbScene,
    workbenchReduceMotion: _legacyWbMotion,
    workbenchShowCartoon: _legacyWbCartoon,
    changesCommitExpanded: _legacyChangesCommitExpanded,
    changesCommitHeight: _legacyChangesCommitHeight,
    ...rest
  } = p as typeof p & {
    workbenchShowScene?: unknown
    workbenchReduceMotion?: unknown
    workbenchShowCartoon?: unknown
    changesCommitExpanded?: unknown
    changesCommitHeight?: unknown
  }
  return {
    ...currentState,
    ...rest,
    // Always cold-start on Chats (product rule).
    activeView: 'chat' as const,
    sidebarSection: 'chats' as const,
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

  // Code surface: ArtifactPanel tabs (files/outline/changes/terminal).
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

  /**
   * Ephemeral footer utility shell (history / trash / settings).
   * Not persisted; independent of activeView (work surface).
   */
  overlay: AppOverlay | null
  setOverlay: (o: AppOverlay | null) => void
  /** Toggle: if already open, close; else open. */
  toggleOverlay: (o: AppOverlay) => void

  /**
   * Settings shell L2 route (Agent/MCP/Skill/Plugin/Memory editors).
   * Ephemeral — not persisted. Reset when overlay leaves settings.
   */
  settingsShellRoute: SettingsShellRoute
  setSettingsShellRoute: (r: SettingsShellRoute) => void

  /** Left sidebar section highlight (not persisted; cold launch 'chats'). */
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

  /** Right-rail tab per managed terminal (`tm_*`), remembered across focus switches. */
  activeTerminalPanelTab: Record<string, TerminalPanelTab>
  setTerminalPanelTab: (terminalId: string, tab: TerminalPanelTab) => void

  diffViewMode: 'unified' | 'split'
  setDiffViewMode: (m: 'unified' | 'split') => void

  /** 展开文件时重新拉取的上下文行数档位（T6；'full' = 现状全文）。 */
  diffContext: number | 'full'
  setDiffContext: (c: number | 'full') => void

  /** T17：更改列表按状态（A/M/D/R）分组显示。 */
  diffGroupByStatus: boolean
  setDiffGroupByStatus: (v: boolean) => void

  ignoreWhitespace: boolean
  setIgnoreWhitespace: (v: boolean) => void

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
        set((s) => {
          if (s.settingsPage === page) return s
          // Switching category pops any L2 editor (nav while on agent-edit, etc.).
          return {
            settingsPage: page,
            settingsShellRoute:
              s.settingsShellRoute.type === 'page'
                ? s.settingsShellRoute
                : SETTINGS_SHELL_PAGE,
          }
        }),

      settingsShellRoute: SETTINGS_SHELL_PAGE,
      setSettingsShellRoute: (r) =>
        set((s) => {
          if (
            s.settingsShellRoute.type === r.type &&
            JSON.stringify(s.settingsShellRoute) === JSON.stringify(r)
          ) {
            return s
          }
          return { settingsShellRoute: r }
        }),

      scrollTargetMessageId: null,
      setScrollTarget: (id) => set((s) => (s.scrollTargetMessageId === id ? s : { scrollTargetMessageId: id })),

      activeTab: 'files',
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
      setActiveView: (v) =>
        set((s) => (s.activeView === v ? s : { activeView: v })),

      overlay: null,
      setOverlay: (o) =>
        set((s) => {
          if (s.overlay === o) return s
          // Leaving settings (or any non-settings overlay) clears L2 route.
          const routePatch =
            o === 'settings' ? {} : { settingsShellRoute: SETTINGS_SHELL_PAGE }
          return { overlay: o, ...routePatch }
        }),
      toggleOverlay: (o) =>
        set((s) => {
          if (s.overlay === o) {
            return { overlay: null, settingsShellRoute: SETTINGS_SHELL_PAGE }
          }
          const routePatch =
            o === 'settings' ? {} : { settingsShellRoute: SETTINGS_SHELL_PAGE }
          return { overlay: o, ...routePatch }
        }),
      sidebarSection: 'chats',
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

      activeTerminalPanelTab: {},
      setTerminalPanelTab: (terminalId, tab) =>
        set((s) =>
          s.activeTerminalPanelTab[terminalId] === tab
            ? s
            : {
                activeTerminalPanelTab: {
                  ...s.activeTerminalPanelTab,
                  [terminalId]: tab,
                },
              },
        ),

      diffViewMode: 'unified',
      setDiffViewMode: (m) => set({ diffViewMode: m }),

      diffContext: 'full',
      setDiffContext: (c) => set((s) => (s.diffContext === c ? s : { diffContext: c })),

      diffGroupByStatus: false,
      setDiffGroupByStatus: (v) => set((s) => (s.diffGroupByStatus === v ? s : { diffGroupByStatus: v })),

      ignoreWhitespace: false,
      setIgnoreWhitespace: (v) => set((s) => (s.ignoreWhitespace === v ? s : { ignoreWhitespace: v })),

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
        ignoreWhitespace: s.ignoreWhitespace,
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
 * Cold launch shell: Chats (default home).
 * Safe to call after rehydrate and once from AppLayout.
 * Nav history is seeded separately from AppLayout (see seedNavHistoryIfEmpty).
 */
export function applyColdLaunchShell(): void {
  useUiStore.setState({
    activeView: 'chat',
    sidebarSection: 'chats',
    overlay: null,
    settingsShellRoute: SETTINGS_SHELL_PAGE,
  })
}
