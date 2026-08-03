import type { RankableItem } from './rankGlobalCommands'

export type CommandGroupId =
  | 'context'
  | 'navigation'
  | 'actions'
  | 'workspace'
  | 'appearance'
  | 'sessions'
  | 'skills'
  | 'settings-pages'
  | 'commands-extra'
  | 'theme'
  | 'favorites'
  | 'recent'
  | string

/** Nested palette pages (theme / model / sessions pickers). */
export type PalettePageId = 'theme' | 'model' | 'sessions'

export type CommandSource =
  | 'builtin-slash'
  | 'action'
  | 'skill'
  | 'session'
  | 'knowledge'
  | 'nav'
  | 'settings'

export type PaletteIconName =
  | 'message-square'
  | 'code'
  | 'history'
  | 'settings'
  | 'plus'
  | 'sun'
  | 'moon'
  | 'monitor'
  | 'palette'
  | 'keyboard'
  | 'brain'
  | 'wrench'
  | 'package'
  | 'cpu'
  | 'git-branch'
  | 'sparkles'
  | 'bot'
  | 'puzzle'
  | 'link-2'
  | 'book-open'
  | 'terminal'
  | 'check-square'
  | 'zap'

export interface CommandWhen {
  /** Restrict command visibility to these shell views (see ActiveView). */
  views?: import('@/store/uiStore').ActiveView[]
  requiresSession?: boolean
  surfaces?: Array<'chat' | 'code' | 'terminal'>
  enabled?: boolean
}

export type GlobalCommand = RankableItem & {
  group: CommandGroupId
  description?: string
  icon?: PaletteIconName
  shortcut?: string
  /** Nested page id (theme | model | sessions). */
  to?: PalettePageId
  keepOpen?: boolean
  when?: CommandWhen
  contextBoost?: number
  /** Slash token without leading slash, when this row mirrors a /command. */
  slashName?: string
  source?: CommandSource
  /** true when this is the active theme/view — UI shows check */
  active?: boolean
  run?: () => void
}

export type PaletteGroup = {
  id?: CommandGroupId
  heading?: string
  items: GlobalCommand[]
}
