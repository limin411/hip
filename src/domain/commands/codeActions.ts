import { toast } from 'sonner'
import i18n from '@/i18n'
import { sessionService } from '../sessionService'
import { useDomainStore } from '../sessionStore'
import { useUiStore } from '@/store/uiStore'
import { markUserDiffRequest } from './diffFeedback'
import { buildInitPrompt } from './initPrompt'

export { markUserDiffRequest, consumeUserDiffRequest } from './diffFeedback'
export { buildInitPrompt, extractInitFocus } from './initPrompt'

/** Switch to Code, open the right panel on Changes, then request the workspace diff. */
function surfaceChangesPanel(sessionId: string): void {
  useUiStore.getState().setTab('changes')
  useUiStore.getState().setActiveView('code')
  // Right panel visibility is gated on session.codePanelOpen (AppLayout rightOpen).
  useDomainStore.getState().setSessionCodePanelOpen(sessionId, true)
}

/** Always navigate to Changes; requestDiff may dedupe while loading. */
export function runDiff(sessionId: string): void {
  surfaceChangesPanel(sessionId)
  const result = sessionService.requestDiff(sessionId)
  if (result === 'deduped') {
    toast.message(i18n.t('chat.diff.loading'))
    return
  }
  markUserDiffRequest(sessionId)
}

export function runCompact(sessionId: string, focus?: string): void {
  sessionService.compactSession(sessionId, focus)
}

/**
 * `/init`: analyze the workspace and create/update AGENTS.md via a guided agent turn.
 * Git repository init remains on GitInitBanner / ChangesView (`gitInitWorkspace`).
 */
export function runInit(sessionId: string, focus?: string): void {
  const st = useDomainStore.getState()
  const session = st.sessions.find((s) => s.id === sessionId)
  if (!session) return

  const cwd = session.config.cwd?.trim()
  if (!cwd) {
    toast.error(i18n.t('chat.init.noWorkspace'))
    return
  }

  if (st.activeSessionId !== sessionId) {
    sessionService.selectSession(sessionId)
  }

  sessionService.sendMessage(buildInitPrompt(focus))
}
