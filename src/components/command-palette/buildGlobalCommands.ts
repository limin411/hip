import type { SessionVM } from '@/domain'
import type { SkillMeta } from '@hip/protocol'
import type { ActiveView, SettingsPageId, Theme } from '@/store/uiStore'
import {
  goSettingsPage,
  formatMemoryStatusBody,
  openMemorySettings,
  runCompact,
  runDiff,
  runInit,
  setIncognito,
  setUseMemories,
  showMemoryStatus,
  toastMemoryFlagChange,
} from '@/domain/commands'
import type { CommandWhen, GlobalCommand, PaletteGroup } from './types'

export type { GlobalCommand, PaletteGroup } from './types'

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
  /** Terminal management (K17) — optional when flag off / labels omitted. */
  openTerminals?: string
  newLocalTerminal?: string
  quickConnect?: string
  themeLight: string
  themeDark: string
  themeSystem: string
  current: string
  settings: {
    general: string
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
  enterKnowledge?: () => void | Promise<void>
  /** Open knowledge surface (chip + activeView). Fallback when enterKnowledge missing. */
  openKnowledgeView?: () => void
  openKnowledgeDoc?: (item: {
    spaceId: string
    docId: string
    title: string
    spaceName: string
  }) => void
  knowledgeOpenHome?: () => void
  knowledgeCreateDoc?: () => void
  searchKnowledgeDocs?: (q: string) => KnowledgeDocHit[]
  knowledgeIndexReady?: boolean
  /** Terminal management (K17). */
  enterTerminals?: () => void | Promise<void>
  openLocalTerminal?: () => void | Promise<void>
  /** Open terminals section for quick-connect (popover lives in sidebar). */
  openQuickConnect?: () => void | Promise<void>
}

/** Source cap for search-time session list. */
export const RECENT_SESSION_LIMIT = 50
/** Max session rows shown after rank (P2-9). */
export const SESSION_DISPLAY_CAP = 15

/** Order matches SettingsPanel NAV_GROUPS (basics → agents). */
const ALL_SETTINGS_PAGES: SettingsPageId[] = [
  'general',
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

function matchesWhen(when: CommandWhen | undefined, ctx: GlobalCommandContext): boolean {
  if (!when) return true
  if (when.enabled === false) return false
  if (when.views && !when.views.includes(ctx.activeView)) return false
  if (when.requiresSession && !ctx.sessionId) return false
  return true
}

/** Pure: most recently updated sessions, capped. */
export function pickRecentSessions(
  sessions: SessionVM[],
  limit = RECENT_SESSION_LIMIT,
): SessionVM[] {
  return [...sessions]
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
    .slice(0, limit)
}

function sessionLabel(s: SessionVM): string {
  const title = s.title.trim()
  if (title) return title
  const preview = s.preview.trim()
  if (preview) return preview.length > 48 ? `${preview.slice(0, 48)}…` : preview
  return s.id
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
      ctx.setSettingsPage(page)
      ctx.setActiveView('settings')
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
        if (ctx.openHistoryFromChrome) void ctx.openHistoryFromChrome()
        else ctx.setActiveView('history')
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
        else ctx.setActiveView('trash')
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
        else {
          ctx.setSettingsPage('general')
          ctx.setActiveView('settings')
        }
      },
    },
    {
      id: 'nav-knowledge',
      label: labels.navKnowledge,
      icon: 'package',
      keywords: ['knowledge', 'notes', 'docs', '知识库', '知識庫', 'markdown'],
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
      keywords: ['knowledge', 'home', 'spaces', '知识库首页', '知識庫首頁'],
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

  const actions: GlobalCommand[] = [
    {
      id: 'action-new-conversation',
      label: labels.actionNewConversation,
      icon: 'plus',
      keywords: ['new', 'chat', 'clear', 'start', '新建', '新增'],
      group: 'actions',
      run: () => ctx.newConversation(surfaceForNewConversation(ctx.activeView)),
    },
    {
      id: 'action-keyboard-shortcuts',
      label: labels.actionKeyboardShortcuts,
      icon: 'keyboard',
      shortcut: `${mod}/`,
      keywords: ['keyboard', 'shortcuts', 'hotkeys', '快捷键', '快捷鍵'],
      group: 'actions',
      run: () => ctx.openShortcutsHelp(),
    },
  ]

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

  const appearance: GlobalCommand[] = [
    {
      id: 'appearance-theme',
      label: labels.actionChangeTheme,
      icon: 'palette',
      keywords: ['theme', 'appearance', 'color', 'dark', 'light', '主题', '主題', '外观', '外觀'],
      group: 'appearance',
      to: 'theme',
    },
  ]

  const contextCandidates: GlobalCommand[] = [
    {
      id: 'ctx-diff',
      label: labels.context.diff,
      icon: 'git-branch',
      keywords: ['diff', 'changes', '变更', '變更'],
      group: 'context',
      when: { requiresSession: true },
      contextBoost: 0.1,
      run: () => {
        if (ctx.sessionId) runDiff(ctx.sessionId)
      },
    },
    {
      id: 'ctx-compact',
      label: labels.context.compact,
      icon: 'package',
      keywords: ['compact', 'summarize', '压缩', '壓縮'],
      group: 'context',
      when: { requiresSession: true },
      contextBoost: 0.1,
      run: () => {
        if (ctx.sessionId) runCompact(ctx.sessionId)
      },
    },
    {
      id: 'ctx-init',
      label: labels.context.init,
      icon: 'sparkles',
      keywords: [
        'init',
        'initialize',
        'agents',
        'AGENTS.md',
        'project',
        'rules',
        '初始化',
        '项目指引',
      ],
      group: 'context',
      when: { requiresSession: true },
      contextBoost: 0.1,
      run: () => {
        if (ctx.sessionId) runInit(ctx.sessionId)
      },
    },
    {
      id: 'ctx-memory-settings',
      label: labels.settings.memory,
      icon: 'brain',
      keywords: ['memory', 'memories', '记忆', '記憶'],
      group: 'context',
      run: () => openMemorySettings(),
    },
    {
      id: 'ctx-memory-on',
      label: labels.context.memoryOn,
      icon: 'brain',
      keywords: ['memory', 'enable', 'on', 'inject', '记忆', '記憶'],
      group: 'context',
      when: { requiresSession: true },
      run: () => {
        if (!ctx.sessionId) return
        setUseMemories(ctx.sessionId, true)
        toastMemoryFlagChange('useOn')
      },
    },
    {
      id: 'ctx-memory-off',
      label: labels.context.memoryOff,
      icon: 'brain',
      keywords: ['memory', 'disable', 'off', '记忆', '記憶'],
      group: 'context',
      when: { requiresSession: true },
      run: () => {
        if (!ctx.sessionId) return
        setUseMemories(ctx.sessionId, false)
        toastMemoryFlagChange('useOff')
      },
    },
    {
      id: 'ctx-memory-incognito',
      label: labels.context.memoryIncognito,
      icon: 'brain',
      keywords: ['memory', 'incognito', 'private', '隐身', '隱身'],
      group: 'context',
      when: { requiresSession: true },
      run: () => {
        if (!ctx.sessionId) return
        setIncognito(ctx.sessionId, true)
        toastMemoryFlagChange('incognitoOn')
      },
    },
    {
      id: 'ctx-memory-incognito-off',
      label: labels.context.memoryIncognitoOff,
      icon: 'brain',
      keywords: ['memory', 'incognito', 'exit', '退出隐身', '退出隱身'],
      group: 'context',
      when: { requiresSession: true },
      run: () => {
        if (!ctx.sessionId) return
        setIncognito(ctx.sessionId, false)
        toastMemoryFlagChange('incognitoOff')
      },
    },
    {
      id: 'ctx-memory-status',
      label: labels.context.memoryStatus,
      icon: 'brain',
      keywords: ['memory', 'status', 'flags', '状态', '狀態'],
      group: 'context',
      when: { requiresSession: true },
      run: () => {
        if (!ctx.sessionId) return
        const flags = formatMemoryStatusBody(ctx.sessionId)
        if (flags) showMemoryStatus(ctx.sessionId, ctx.memoryStatusCopy(flags))
      },
    },
  ]

  const context = contextCandidates.filter((c) => matchesWhen(c.when, ctx))

  // When no session is bound, still surface a hint so Suggested is not only "Settings: Memory".
  if (!ctx.sessionId) {
    context.unshift({
      id: 'ctx-need-session',
      label: labels.context.needSession,
      icon: 'message-square',
      keywords: ['session', 'conversation', '会话', '對話', 'open'],
      group: 'context',
      description: labels.context.needSessionHint,
      run: () => {
        // Prefer starting a conversation on the current surface.
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
    { id: 'navigation', heading: labels.groupNavigation, items: navigation },
    { id: 'actions', heading: labels.groupActions, items: actions },
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
    const recent = pickRecentSessions(ctx.sessions)
    if (recent.length > 0) {
      const sessions: GlobalCommand[] = recent.map((s) => {
        const label = sessionLabel(s)
        return {
          id: `session-${s.id}`,
          label,
          icon: 'message-square' as const,
          keywords: [s.id, s.preview, s.title, 'session', '会话', '對話'].filter(Boolean),
          group: 'sessions' as const,
          run: () => ctx.selectSession(s.id),
        }
      })
      groups.push({
        id: 'sessions',
        heading: labels.groupSessions,
        items: sessions.slice(0, SESSION_DISPLAY_CAP),
      })
    }
  }

  return groups
}

/** Re-export for callers that deep-link into settings without palette. */
export { goSettingsPage }
