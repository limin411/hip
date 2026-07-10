import type { SessionVM } from '@/domain'
import type { ActiveView, Theme } from '@/store/uiStore'
import type { RankableItem } from './rankGlobalCommands'

export type GlobalCommand = RankableItem & {
  group: 'navigation' | 'sessions' | 'theme' | 'actions'
  run: () => void
}

export type GlobalCommandLabels = {
  groupNavigation: string
  groupActions: string
  groupTheme: string
  groupSessions: string
  navChat: string
  navCode: string
  navHistory: string
  navSettings: string
  actionNewConversation: string
  themeLight: string
  themeDark: string
  themeSystem: string
}

export type GlobalCommandContext = {
  sessions: SessionVM[]
  activeView: ActiveView
  theme: Theme
  labels: GlobalCommandLabels
  setActiveView: (v: ActiveView) => void
  setTheme: (t: Theme) => void
  /** Optional surface: chat | code. When omitted, handler may default. */
  newConversation: (surface?: 'chat' | 'code') => void
  selectSession: (id: string) => void
}

export type PaletteGroup = {
  heading?: string
  items: GlobalCommand[]
}

export const RECENT_SESSION_LIMIT = 10

function surfaceForNewConversation(activeView: ActiveView): 'chat' | 'code' {
  return activeView === 'code' ? 'code' : 'chat'
}

/**
 * Build command groups for the global palette.
 * PR-5: navigation, actions, theme. PR-6: recent sessions.
 */
export function buildGlobalCommandGroups(ctx: GlobalCommandContext): PaletteGroup[] {
  const { labels } = ctx

  const navigation: GlobalCommand[] = [
    {
      id: 'nav-chat',
      label: labels.navChat,
      keywords: ['work', 'office', 'chat', '办公'],
      group: 'navigation',
      run: () => ctx.setActiveView('chat'),
    },
    {
      id: 'nav-code',
      label: labels.navCode,
      keywords: ['coding', 'code', 'project', '编码'],
      group: 'navigation',
      run: () => ctx.setActiveView('code'),
    },
    {
      id: 'nav-history',
      label: labels.navHistory,
      keywords: ['sessions', 'past', '历史'],
      group: 'navigation',
      run: () => ctx.setActiveView('history'),
    },
    {
      id: 'nav-settings',
      label: labels.navSettings,
      keywords: ['prefs', 'preferences', 'config', '设置'],
      group: 'navigation',
      run: () => ctx.setActiveView('settings'),
    },
  ]

  const actions: GlobalCommand[] = [
    {
      id: 'action-new-conversation',
      label: labels.actionNewConversation,
      keywords: ['new', 'chat', 'clear', 'start', '新建'],
      group: 'actions',
      run: () => ctx.newConversation(surfaceForNewConversation(ctx.activeView)),
    },
  ]

  const theme: GlobalCommand[] = [
    {
      id: 'theme-light',
      label: labels.themeLight,
      keywords: ['light', 'day', '浅色'],
      group: 'theme',
      run: () => ctx.setTheme('light'),
    },
    {
      id: 'theme-dark',
      label: labels.themeDark,
      keywords: ['dark', 'night', '深色'],
      group: 'theme',
      run: () => ctx.setTheme('dark'),
    },
    {
      id: 'theme-system',
      label: labels.themeSystem,
      keywords: ['system', 'auto', '跟随'],
      group: 'theme',
      run: () => ctx.setTheme('system'),
    },
  ]

  // Sessions group filled in PR-6 from ctx.sessions.
  void ctx.sessions
  void ctx.selectSession

  return [
    { heading: labels.groupNavigation, items: navigation },
    { heading: labels.groupActions, items: actions },
    { heading: labels.groupTheme, items: theme },
  ]
}
