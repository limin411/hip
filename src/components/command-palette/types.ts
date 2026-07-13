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
  | string

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

export interface CommandWhen {
  views?: Array<'chat' | 'code' | 'history' | 'settings' | 'knowledge'>
  requiresSession?: boolean
  surfaces?: Array<'chat' | 'code'>
  enabled?: boolean
}

export type GlobalCommand = RankableItem & {
  group: CommandGroupId
  description?: string
  icon?: PaletteIconName
  shortcut?: string
  to?: string
  keepOpen?: boolean
  when?: CommandWhen
  contextBoost?: number
  /** true when this is the active theme/view — UI shows check */
  active?: boolean
  run?: () => void
}

export type PaletteGroup = {
  id?: CommandGroupId
  heading?: string
  items: GlobalCommand[]
}
