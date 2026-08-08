import type { SessionVM } from '@/domain'
import type { SkillMeta } from '@hip/protocol'
import type { ActiveView, SettingsPageId, Theme } from '@/store/uiStore'
import { goSettingsPage } from '@/domain/commands'
import { buildContextFromSlashCatalog } from './catalog'
import { matchesWhen } from './matchesWhen'
import type { GlobalCommand, PaletteGroup, PalettePageId } from './types'
import { isTerminalSession } from '@/lib/sessions'

export type { GlobalCommand, PaletteGroup, PalettePageId } from './types'
export { matchesWhen, resolvePaletteSurface } from './matchesWhen'

export type GlobalCommandLabels = {
  groupNavigation: string
  groupActions: string
  groupTheme: string
  groupSessions: string
  groupContext: string
  groupWorkspace: string
  groupAppearance: string
  groupSkills: string
  groupFavorites: string
  groupKnowledge: string
  /** 文档 group heading for search hits (V2-S1). */
  groupDocs?: string
  /** 最近 group heading for recent docs (V2-S1). */
  groupRecentDocs?: string
  groupRecent?: string
  navChat: string
  navCode: string
  navHistory: string
  navTrash: string
  navSettings: string
  navKnowledge: string
  knowledgeHome: string
  knowledgeNewDoc: string
  knowledgeIndexing: string
  knowledgeNeedSpace: string
  actionNewConversation: string
  actionKeyboardShortcuts: string
  actionChangeTheme: string
  actionSwitchModel?: string
  actionResumeSession?: string
  /** Terminal management (K17) — optional when flag off / labels omitted. */
  openTerminals?: string
  newLocalTerminal?: string
  quickConnect?: string
  /** Work item tracking (K19) — optional when flag off / labels omitted. */
  openWorkItems?: string
  newWorkItem?: string
  /** Automations page — optional when flag off / labels omitted. */
  openAutomations?: string
  themeLight: string
  themeDark: string
  themeSystem: string
  current: string
  settings: {
    general: string
    voice: string
    window: string
    model: string
    agents: string
    mcp: string
    connectors: string
    skill: string
    plugins: string
    hooks: string
    memory: string
  }
  context: {
    diff: string
    compact: string
    init: string
    plan: string
    planOff: string
    memoryOn: string
    memoryOff: string
    memoryIncognito: string
    memoryIncognitoOff: string
    memoryStatus: string
    /** Shown when no session is available for session-gated actions. */
    needSession: string
    needSessionHint: string
  }
}

export type KnowledgeDocHit = {
  spaceId: string
  docId: string
  title: string
  spaceName: string
  path: string
  snippet?: string
  /** MiniSearch score (descending) — unused by palette, kept for tests. */
  score?: number
}

export type GlobalCommandContext = {
  sessions: SessionVM[]
  activeView: ActiveView
  theme: Theme
  labels: GlobalCommandLabels
  sessionId: string | null
  setActiveView: (v: ActiveView) => void
  setTheme: (t: Theme) => void
  setSettingsPage: (p: SettingsPageId) => void
  /** Optional surface: chat | code. When omitted, handler may default. */
  newConversation: (surface?: 'chat' | 'code') => void
  selectSession: (id: string) => void
  openShortcutsHelp: () => void
  /** Localized memory status toast copy */
  memoryStatusCopy: (flags: { use: string; generate: string; incognito: string }) => {
    title: string
    body: string
  }
  isMac?: boolean
  /** Current search (providers use for search-only long tails). */
  search?: string
  /** Installed skills for search-time provider. */
  skills?: SkillMeta[]
  /** Skill id → enabled; missing key means enabled. */
  skillsEnabled?: Record<string, boolean>
  /** Shell helpers (preferred over bare setActiveView for leave-knowledge flush). */
  enterSection?: (section: 'projects' | 'chats') => void | Promise<void>
  openHistoryFromChrome?: () => void | Promise<void>
  openTrashFromChrome?: () => void | Promise<void>
  openSettingsFromChrome?: () => void | Promise<void>
  /** Canonical Settings overlay open (page wins when provided). */
  openSettingsOverlay?: (page?: SettingsPageId) => void
  enterKnowledge?: () => void | Promise<void>
  /** Open knowledge surface (chip + activeView). Fallback when enterKnowledge missing. */
  openKnowledgeView?: () => void
  openKnowledgeDoc?: (item: {
    spaceId: string
    docId: string
    title: string
    spaceName: string
    /** ⌘K search query — workspace scrolls + flashes the match (V2-S1). */
    query?: string
  }) => void
  knowledgeOpenHome?: () => void
  knowledgeCreateDoc?: () => void
  searchKnowledgeDocs?: (q: string) => KnowledgeDocHit[]
  knowledgeIndexReady?: boolean
  /** Recently opened docs (V2-S1 recent group). */
  recentDocs?: Array<{ spaceId: string; docId: string; title: string; spaceName: string; at: number }>
  /** Terminal management (K17). */
  enterTerminals?: () => void | Promise<void>
  openLocalTerminal?: () => void | Promise<void>
  /** Open terminals section for quick-connect (popover lives in sidebar). */
  openQuickConnect?: () => void | Promise<void>
  /** Work item tracking (K19). */
  enterWorkItems?: () => void | Promise<void>
  /** Enter work items section then create a new item. */
  newWorkItem?: () => void | Promise<void>
  /** Automations section (flag-gated). */
  enterAutomations?: () => void | Promise<void>
  /** Open a nested palette page (theme / model / sessions). */
  openPalettePage?: (page: PalettePageId) => void
  /** Switch model for active session or draft (`provider/model` key). */
  setModelKey?: (modelKey: string) => void
  /** Currently selected model key (for active check on model page). */
  currentModelKey?: string | null
  /** Grouped models for the model subpage (same shape as ModelPicker). */
  modelOptions?: Array<{
    providerID: string
    providerName: string
    models: Array<{ key: string; modelID: string }>
  }>
}

/** Source cap for search-time session list. */
export const RECENT_SESSION_LIMIT = 50
/** Max session rows shown after rank (P2-9). */
export const SESSION_DISPLAY_CAP = 15

/** Order matches SettingsPanel NAV_GROUPS (basics → agents). */
const ALL_SETTINGS_PAGES: SettingsPageId[] = [
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

/** Shown on empty query (curated). */
const CURATED_SETTINGS: SettingsPageId[] = ['model', 'memory', 'skill', 'mcp']

const SETTINGS_ICON: Record<SettingsPageId, GlobalCommand['icon']> = {
  general: 'settings',
  voice: 'settings',
  window: 'settings',
  model: 'cpu',
  agents: 'bot',
  mcp: 'wrench',
  connectors: 'link-2',
  skill: 'sparkles',
  plugins: 'puzzle',
  hooks: 'link-2',
  memory: 'brain',
}

function surfaceForNewConversation(activeView: ActiveView): 'chat' | 'code' {
  return activeView === 'code' ? 'code' : 'chat'
}

/** Pure: most recently updated sessions, capped. */
export function pickRecentSessions(
  sessions: SessionVM[],
  limit = RECENT_SESSION_LIMIT,
): SessionVM[] {
  return sessions
    .filter((s) => !isTerminalSession(s.config))
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
    .slice(0, limit)
}

export function sessionLabel(s: SessionVM): string {
  const title = s.title.trim()
  if (title) return title
  const preview = s.preview.trim()
  if (preview) return preview.length > 48 ? `${preview.slice(0, 48)}…` : preview
  return s.id
}

/** Session rows for long-tail search or sessions subpage. */
export function buildSessionCommands(
  ctx: GlobalCommandContext,
  opts?: { limit?: number },
): GlobalCommand[] {
  const limit = opts?.limit ?? SESSION_DISPLAY_CAP
  return pickRecentSessions(ctx.sessions).slice(0, limit).map((s) => {
    const label = sessionLabel(s)
    return {
      id: `session-${s.id}`,
      label,
      icon: 'message-square' as const,
      keywords: [s.id, s.preview, s.title, 'session', '会话', '對話'].filter(Boolean),
      group: 'sessions' as const,
      source: 'session' as const,
      run: () => ctx.selectSession(s.id),
    }
  })
}

function settingsLabel(labels: GlobalCommandLabels, page: SettingsPageId): string {
  return labels.settings[page]
}

function buildSettingsCommands(
  ctx: GlobalCommandContext,
  pages: SettingsPageId[],
): GlobalCommand[] {
  return pages.map((page) => ({
    id: `settings-${page}`,
    label: settingsLabel(ctx.labels, page),
    icon: SETTINGS_ICON[page],
    keywords: [
      'settings',
      'prefs',
      'config',
      '设置',
      '設定',
      page,
      settingsLabel(ctx.labels, page),
    ],
    group: 'workspace' as const,
    run: () => {
      if (ctx.openSettingsOverlay) {
        ctx.openSettingsOverlay(page)
      } else {
        // Fallback without chrome helper: same store path as openSettingsOverlay.
        void import('@/store/uiStore').then(({ useUiStore }) => {
          useUiStore.getState().setSettingsPage(page)
          useUiStore.getState().setOverlay('settings')
        })
      }
    },
  }))
}

function buildThemeModeItems(ctx: GlobalCommandContext, keepOpen: boolean): GlobalCommand[] {
  const { labels, theme } = ctx
  return [
    {
      id: 'theme-light',
      label: labels.themeLight,
      icon: 'sun' as const,
      keywords: ['light', 'day', '浅色', '淺色', 'theme', '主题', '主題'],
      group: 'theme' as const,
      keepOpen,
      active: theme === 'light',
      description: theme === 'light' ? labels.current : undefined,
      run: () => ctx.setTheme('light'),
    },
    {
      id: 'theme-dark',
      label: labels.themeDark,
      icon: 'moon' as const,
      keywords: ['dark', 'night', '深色', 'theme', '主题', '主題'],
      group: 'theme' as const,
      keepOpen,
      active: theme === 'dark',
      description: theme === 'dark' ? labels.current : undefined,
      run: () => ctx.setTheme('dark'),
    },
    {
      id: 'theme-system',
      label: labels.themeSystem,
      icon: 'monitor' as const,
      keywords: ['system', 'auto', '跟随', '跟隨', 'theme', '主题', '主題'],
      group: 'theme' as const,
      keepOpen,
      active: theme === 'system',
      description: theme === 'system' ? labels.current : undefined,
      run: () => ctx.setTheme('system'),
    },
  ]
}

/**
 * Theme subpage groups (page === 'theme').
 */
export function buildThemePageGroups(ctx: GlobalCommandContext): PaletteGroup[] {
  return [
    {
      id: 'theme',
      heading: ctx.labels.groupTheme,
      items: buildThemeModeItems(ctx, true),
    },
  ]
}

/**
 * Build command groups for the global palette.
 * Empty search: curated navigation/actions/workspace/appearance (no sessions).
 * Non-empty search (or forceSessions for `#` prefix): + sessions / theme modes.
 */
export function buildGlobalCommandGroups(
  ctx: GlobalCommandContext,
  opts?: { search?: string; forceSessions?: boolean },
): PaletteGroup[] {
  const { labels } = ctx
  const search = (opts?.search ?? '').trim()
  const includeLongTail = search.length > 0 || Boolean(opts?.forceSessions)
  const includeThemeSearch = search.length > 0
  const mod = ctx.isMac ? '⌘' : 'Ctrl+'

  const navigation: GlobalCommand[] = [
    {
      id: 'nav-chat',
      label: labels.navChat,
      icon: 'message-square',
      keywords: ['work', 'office', 'chat', '办公', '辦公'],
      group: 'navigation',
      run: () => {
        if (ctx.enterSection) void ctx.enterSection('chats')
        else ctx.setActiveView('chat')
      },
    },
    {
      id: 'nav-code',
      label: labels.navCode,
      icon: 'code',
      keywords: ['coding', 'code', 'project', '编码', '編碼'],
      group: 'navigation',
      run: () => {
        if (ctx.enterSection) void ctx.enterSection('projects')
        else ctx.setActiveView('code')
      },
    },
    {
      id: 'nav-history',
      label: labels.navHistory,
      icon: 'history',
      keywords: ['sessions', 'past', '历史', '歷史'],
      group: 'navigation',
      run: () => {
        // Overlay openers (no leave-flush / no activeView history).
        if (ctx.openHistoryFromChrome) void ctx.openHistoryFromChrome()
        else {
          void import('@/components/layout/sidebarActions').then(({ openHistoryOverlay }) => {
            openHistoryOverlay()
          })
        }
      },
    },
    {
      id: 'nav-trash',
      label: labels.navTrash,
      icon: 'history',
      keywords: ['recycle', 'bin', 'trash', '回收站', '回收'],
      group: 'navigation',
      run: () => {
        if (ctx.openTrashFromChrome) void ctx.openTrashFromChrome()
        else {
          void import('@/components/layout/sidebarActions').then(({ openTrashOverlay }) => {
            openTrashOverlay()
          })
        }
      },
    },
    {
      id: 'nav-settings',
      label: labels.navSettings,
      icon: 'settings',
      keywords: ['prefs', 'preferences', 'config', '设置', '設定'],
      group: 'navigation',
      run: () => {
        if (ctx.openSettingsFromChrome) void ctx.openSettingsFromChrome()
        else if (ctx.openSettingsOverlay) ctx.openSettingsOverlay()
        else {
          void import('@/store/uiStore').then(({ useUiStore }) => {
            useUiStore.getState().setSettingsPage('general')
            useUiStore.getState().setOverlay('settings')
          })
        }
      },
    },
    {
      id: 'nav-knowledge',
      label: labels.navKnowledge,
      icon: 'package',
      keywords: ['knowledge', 'notes', 'docs', '知识库', '知識庫', '文档管理', '文檔管理', 'markdown'],
      group: 'navigation',
      run: () => {
        if (ctx.enterKnowledge) void ctx.enterKnowledge()
        else ctx.openKnowledgeView?.()
      },
    },
    {
      id: 'knowledge-go-home',
      label: labels.knowledgeHome,
      icon: 'package',
      keywords: ['knowledge', 'home', 'spaces', '知识库首页', '知識庫首頁', '文档管理首页', '文檔管理首頁'],
      group: 'navigation',
      when: { views: ['knowledge'] },
      run: () => {
        ctx.knowledgeOpenHome?.()
      },
    },
    {
      id: 'knowledge-new-doc',
      label: labels.knowledgeNewDoc,
      icon: 'plus',
      keywords: ['knowledge', 'new', 'doc', '新建文档', '新增文件'],
      group: 'actions',
      when: { views: ['knowledge'] },
      run: () => {
        ctx.knowledgeCreateDoc?.()
      },
    },
  ]

  // Terminal management (K17) — only when labels + handlers are provided (flag on).
  if (labels.openTerminals && ctx.enterTerminals) {
    navigation.push({
      id: 'nav-terminals',
      label: labels.openTerminals,
      icon: 'terminal',
      keywords: [
        'terminal',
        'terminals',
        'ssh',
        'shell',
        '终端',
        '終端',
        '端末',
        '터미널',
        labels.openTerminals,
      ],
      group: 'navigation',
      run: () => {
        void ctx.enterTerminals?.()
      },
    })
  }

  // Work item tracking (K19) — only when labels + handlers are provided (flag on).
  if (labels.openWorkItems && ctx.enterWorkItems) {
    navigation.push({
      id: 'nav-work-items',
      label: labels.openWorkItems,
      icon: 'check-square',
      keywords: [
        'work',
        'items',
        'tasks',
        'todo',
        '事项',
        '事項',
        'タスク',
        '할 일',
        labels.openWorkItems,
      ],
      group: 'navigation',
      run: () => {
        void ctx.enterWorkItems?.()
      },
    })
  }

  // Automations — only when labels + handlers are provided (flag on).
  if (labels.openAutomations && ctx.enterAutomations) {
    navigation.push({
      id: 'nav-automations',
      label: labels.openAutomations,
      icon: 'zap',
      keywords: [
        'automation',
        'automations',
        'schedule',
        'cron',
        'scheduled',
        '自动',
        '自動化',
        '自动化',
        'オートメーション',
        '자동화',
        labels.openAutomations,
      ],
      group: 'navigation',
      run: () => {
        void ctx.enterAutomations?.()
      },
    })
  }

  const actions: GlobalCommand[] = [
    {
      id: 'action-new-conversation',
      label: labels.actionNewConversation,
      icon: 'plus',
      keywords: ['new', 'chat', 'clear', 'start', '新建', '新增'],
      group: 'actions',
      source: 'action',
      run: () => ctx.newConversation(surfaceForNewConversation(ctx.activeView)),
    },
    {
      id: 'action-keyboard-shortcuts',
      label: labels.actionKeyboardShortcuts,
      icon: 'keyboard',
      shortcut: `${mod}/`,
      keywords: ['keyboard', 'shortcuts', 'hotkeys', '快捷键', '快捷鍵'],
      group: 'actions',
      source: 'action',
      run: () => ctx.openShortcutsHelp(),
    },
  ]

  if (labels.actionSwitchModel) {
    actions.push({
      id: 'action-switch-model',
      label: labels.actionSwitchModel,
      icon: 'cpu',
      keywords: ['model', 'llm', 'switch', '模型', '切换'],
      group: 'actions',
      source: 'action',
      to: 'model',
      run: ctx.openPalettePage ? () => ctx.openPalettePage!('model') : undefined,
    })
  }

  if (labels.actionResumeSession) {
    actions.push({
      id: 'action-resume-session',
      label: labels.actionResumeSession,
      icon: 'history',
      keywords: ['resume', 'session', 'recent', '恢复', '会话', '對話'],
      group: 'actions',
      source: 'action',
      to: 'sessions',
      run: ctx.openPalettePage ? () => ctx.openPalettePage!('sessions') : undefined,
    })
  }

  if (labels.newLocalTerminal && ctx.openLocalTerminal) {
    actions.push({
      id: 'action-new-local-terminal',
      label: labels.newLocalTerminal,
      icon: 'terminal',
      keywords: [
        'terminal',
        'local',
        'shell',
        'pty',
        '本地终端',
        '本機終端',
        'ローカル',
        '로컬',
        labels.newLocalTerminal,
      ],
      group: 'actions',
      run: () => {
        void ctx.openLocalTerminal?.()
      },
    })
  }

  if (labels.quickConnect && (ctx.openQuickConnect || ctx.enterTerminals)) {
    actions.push({
      id: 'action-quick-connect',
      label: labels.quickConnect,
      icon: 'terminal',
      keywords: [
        'quick',
        'connect',
        'recent',
        'ssh',
        '快捷连接',
        '快捷連線',
        'クイック',
        '빠른 연결',
        labels.quickConnect,
      ],
      group: 'actions',
      run: () => {
        if (ctx.openQuickConnect) void ctx.openQuickConnect()
        else void ctx.enterTerminals?.()
      },
    })
  }

  if (labels.newWorkItem && ctx.newWorkItem) {
    actions.push({
      id: 'action-new-work-item',
      label: labels.newWorkItem,
      icon: 'plus',
      keywords: [
        'work',
        'item',
        'new',
        'todo',
        'task',
        '新建事项',
        '新增事項',
        '新規',
        '새 항목',
        labels.newWorkItem,
      ],
      group: 'actions',
      run: () => {
        void ctx.newWorkItem?.()
      },
    })
  }

  const appearance: GlobalCommand[] = [
    {
      id: 'appearance-theme',
      label: labels.actionChangeTheme,
      icon: 'palette',
      keywords: ['theme', 'appearance', 'color', 'dark', 'light', '主题', '主題', '外观', '外觀'],
      group: 'appearance',
      source: 'action',
      to: 'theme',
      run: ctx.openPalettePage ? () => ctx.openPalettePage!('theme') : undefined,
    },
  ]

  // Context / Suggested rows from slash builtins (surfaces + requiresSession via matchesWhen).
  const context = buildContextFromSlashCatalog(ctx).filter((c) => matchesWhen(c.when, ctx))

  // When no session is bound, still surface a hint so Suggested is not only "Settings: Memory".
  if (!ctx.sessionId) {
    context.unshift({
      id: 'ctx-need-session',
      label: labels.context.needSession,
      icon: 'message-square',
      keywords: ['session', 'conversation', '会话', '對話', 'open'],
      group: 'context',
      source: 'action',
      description: labels.context.needSessionHint,
      run: () => {
        ctx.newConversation(ctx.activeView === 'code' ? 'code' : 'chat')
      },
    })
  }

  const workspace = buildSettingsCommands(
    ctx,
    search.length > 0 ? ALL_SETTINGS_PAGES : CURATED_SETTINGS,
  )

  // Avoid duplicate "Settings: Memory" when context already has memory settings entry on empty query.
  const workspaceFiltered =
    search.length === 0 && context.some((c) => c.id === 'ctx-memory-settings')
      ? workspace.filter((w) => w.id !== 'settings-memory')
      : workspace

  const groups: PaletteGroup[] = []

  if (context.length > 0) {
    groups.push({ id: 'context', heading: labels.groupContext, items: context })
  }
  groups.push(
    {
      id: 'navigation',
      heading: labels.groupNavigation,
      items: navigation.filter((c) => matchesWhen(c.when, ctx)),
    },
    {
      id: 'actions',
      heading: labels.groupActions,
      items: actions.filter((c) => matchesWhen(c.when, ctx)),
    },
    { id: 'workspace', heading: labels.groupWorkspace, items: workspaceFiltered },
    { id: 'appearance', heading: labels.groupAppearance, items: appearance },
  )

  if (includeThemeSearch) {
    groups.push({
      id: 'theme',
      heading: labels.groupTheme,
      items: buildThemeModeItems(ctx, true),
    })
  }

  if (includeLongTail) {
    const sessions = buildSessionCommands(ctx)
    if (sessions.length > 0) {
      groups.push({
        id: 'sessions',
        heading: labels.groupSessions,
        items: sessions,
      })
    }
  }

  return groups
}

/** Model subpage groups (page === 'model'). */
export function buildModelPageGroups(ctx: GlobalCommandContext): PaletteGroup[] {
  const models = ctx.modelOptions ?? []
  const items: GlobalCommand[] = []
  for (const g of models) {
    for (const m of g.models) {
      const active = ctx.currentModelKey === m.key
      items.push({
        id: `model-${m.key}`,
        label: m.modelID,
        description: active ? ctx.labels.current : g.providerName,
        icon: 'cpu',
        keywords: [m.key, m.modelID, g.providerName, g.providerID, 'model', '模型'],
        group: 'theme',
        source: 'action',
        active,
        keepOpen: false,
        run: () => ctx.setModelKey?.(m.key),
      })
    }
  }
  return [
    {
      id: 'model',
      heading: ctx.labels.actionSwitchModel ?? ctx.labels.settings.model,
      items,
    },
  ]
}

/** Sessions subpage (page === 'sessions'). */
export function buildSessionsPageGroups(ctx: GlobalCommandContext): PaletteGroup[] {
  const items = buildSessionCommands(ctx, { limit: SESSION_DISPLAY_CAP })
  return [
    {
      id: 'sessions',
      heading: ctx.labels.groupSessions,
      items,
    },
  ]
}

/** Re-export for callers that deep-link into settings without palette. */
export { goSettingsPage }
