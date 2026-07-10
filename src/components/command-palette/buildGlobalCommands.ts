import type { SessionVM } from '@/domain'
import type { ActiveView, Theme } from '@/store/uiStore'
import type { RankableItem } from './rankGlobalCommands'

export type GlobalCommand = RankableItem & {
  group: 'navigation' | 'sessions' | 'theme' | 'actions'
  run: () => void
}

export type GlobalCommandContext = {
  sessions: SessionVM[]
  activeView: ActiveView
  theme: Theme
  setActiveView: (v: ActiveView) => void
  setTheme: (t: Theme) => void
  newConversation: () => void
  selectSession: (id: string) => void
}

export type PaletteGroup = {
  heading?: string
  items: GlobalCommand[]
}

export const RECENT_SESSION_LIMIT = 10

/**
 * Build command groups for the global palette.
 * Skeleton returns empty groups; PR-5/6 fill navigation, theme, actions, sessions.
 */
export function buildGlobalCommandGroups(_ctx: GlobalCommandContext): PaletteGroup[] {
  // Phase B skeleton: structure ready, no actions yet (avoids half-wired side effects).
  return []
}
