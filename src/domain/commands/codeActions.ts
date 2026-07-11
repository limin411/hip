import { toast } from 'sonner'
import i18n from '@/i18n'
import { sessionService } from '../sessionService'
import { useUiStore } from '@/store/uiStore'
import { markUserDiffRequest } from './diffFeedback'

export { markUserDiffRequest, consumeUserDiffRequest } from './diffFeedback'

/** Always navigate to Changes; requestDiff may dedupe while loading. */
export function runDiff(sessionId: string): void {
  useUiStore.getState().setTab('changes')
  useUiStore.getState().setActiveView('code')
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
  useUiStore.getState().setTab('changes')
  useUiStore.getState().setActiveView('code')
}
