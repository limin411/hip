/**
 * Coerce residual special activeViews / legacy nav frames to a real work surface
 * under an overlay shell. Never returns settings|history|trash.
 */
import { useDomainStore } from '@/domain/sessionStore'
import { surfaceOf } from '@/lib/sessions'
import type { NavEntry } from '@/store/navHistoryStore'
import type { ActiveView, SidebarSection } from '@/store/uiStore'

export type WorkSurface = { view: ActiveView; section: SidebarSection }

/**
 * Resolve a non-special work surface for the main column under an overlay.
 * Never returns settings|history|trash.
 */
export function coerceWorkSurfaceFromUi(s: {
  activeView: ActiveView
  sidebarSection: SidebarSection
  chatSessionId: string | null
  codeSessionId: string | null
}): WorkSurface {
  // If already on a real work surface, keep it.
  if (
    s.activeView !== 'settings' &&
    s.activeView !== 'history' &&
    s.activeView !== 'trash'
  ) {
    return { view: s.activeView, section: s.sidebarSection }
  }
  // Residual special activeView: prefer domain active session, else surface pointers.
  const domain = useDomainStore.getState()
  const activeId = domain.activeSessionId
  const sess =
    (activeId && domain.sessions.find((x) => x.id === activeId)) ||
    (s.codeSessionId && domain.sessions.find((x) => x.id === s.codeSessionId)) ||
    (s.chatSessionId && domain.sessions.find((x) => x.id === s.chatSessionId)) ||
    null
  if (sess) {
    const surface = surfaceOf(sess.config)
    return {
      view: surface,
      section: surface === 'code' ? 'projects' : 'chats',
    }
  }
  return { view: 'chat', section: 'chats' }
}

/** Same rules for a NavEntry being applied (legacy special frames). */
export function coerceUnderlyingFromEntry(entry: NavEntry): WorkSurface {
  if (entry.sessionId) {
    const sess = useDomainStore.getState().sessions.find((x) => x.id === entry.sessionId)
    if (sess) {
      const surface = surfaceOf(sess.config)
      return {
        view: surface,
        section: surface === 'code' ? 'projects' : 'chats',
      }
    }
  }
  if (
    entry.sidebarSection === 'knowledge' ||
    entry.sidebarSection === 'terminals' ||
    entry.sidebarSection === 'tasks' ||
    entry.sidebarSection === 'automation'
  ) {
    return {
      view: entry.sidebarSection as ActiveView,
      section: entry.sidebarSection,
    }
  }
  if (entry.sidebarSection === 'projects') {
    return { view: 'code', section: 'projects' }
  }
  return { view: 'chat', section: 'chats' }
}
