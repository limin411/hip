import { sessionService } from '../sessionService'
import { useUiStore } from '@/store/uiStore'

export function runDiff(sessionId: string): void {
  sessionService.requestDiff(sessionId)
  useUiStore.getState().setTab('changes')
  useUiStore.getState().setActiveView('code')
}

export function runCompact(sessionId: string, focus?: string): void {
  sessionService.compactSession(sessionId, focus)
}

export function runInit(sessionId: string): void {
  sessionService.gitInitWorkspace(sessionId)
}
