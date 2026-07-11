import { toast } from 'sonner'
import i18n from '@/i18n'
import { sessionService } from '../sessionService'
import { useDomainStore } from '../sessionStore'
import { useUiStore } from '@/store/uiStore'
import { markUserDiffRequest } from './diffFeedback'

export { markUserDiffRequest, consumeUserDiffRequest } from './diffFeedback'

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

/** Initialize git workspace and surface Changes (aligned with runDiff). */
export function runInit(sessionId: string): void {
  sessionService.gitInitWorkspace(sessionId)
  surfaceChangesPanel(sessionId)
}
