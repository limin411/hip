import type { TFunction } from 'i18next'
import { copyText } from '@/ipc/clipboard'
import { useDomainStore } from '@/domain'
import { useUiStore, type Surface } from '@/store/uiStore'
import { detectIsMac } from '@/components/command-palette/keys'
import type { ContextMenuBuildContext } from './types'

/**
 * Build a snapshot ContextMenuBuildContext from current stores.
 * Pure getState reads — safe to call outside React (e.g. onOpenChange).
 */
export function createContextMenuBuildContext(
  t: TFunction,
  opts?: { sessionId?: string | null },
): ContextMenuBuildContext {
  const ui = useUiStore.getState()
  const domain = useDomainStore.getState()
  const activeSessionId = domain.activeSessionId
  const targetId = opts?.sessionId ?? activeSessionId
  const session = targetId
    ? domain.sessions.find((s) => s.id === targetId)
    : undefined

  const activeView = ui.activeView
  const surface: Surface | null =
    activeView === 'chat' || activeView === 'code' ? activeView : null

  return {
    t,
    isMac: detectIsMac(),
    activeView,
    surface,
    activeSessionId,
    sessionStatus: session?.status ?? 'idle',
    sessionInterrupt: Boolean(session?.interrupt),
    copyText,
  }
}
