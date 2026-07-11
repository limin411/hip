import { toast } from 'sonner'
import i18n from '@/i18n'
import { sessionService } from '../sessionService'
import { useDomainStore } from '../sessionStore'
import { useUiStore, type SettingsPageId } from '@/store/uiStore'

export function openMemorySettings(): void {
  useUiStore.getState().setSettingsPage('memory')
  useUiStore.getState().setActiveView('settings')
}

export function goSettingsPage(page: SettingsPageId): void {
  useUiStore.getState().setSettingsPage(page)
  useUiStore.getState().setActiveView('settings')
}

export function setUseMemories(sessionId: string, on: boolean): void {
  sessionService.setMemoryFlags(sessionId, { useMemories: on })
}

export function setIncognito(sessionId: string, on = true): void {
  sessionService.setMemoryFlags(sessionId, { incognito: on })
}

export type MemoryFlagToastKind = 'useOn' | 'useOff' | 'incognitoOn' | 'incognitoOff'

/** Short confirmation after a memory flag change (palette / slash). */
export function toastMemoryFlagChange(kind: MemoryFlagToastKind): void {
  const key =
    kind === 'useOn'
      ? 'chat.memory.enabled'
      : kind === 'useOff'
        ? 'chat.memory.disabled'
        : kind === 'incognitoOn'
          ? 'chat.memory.incognitoOn'
          : 'chat.memory.incognitoOff'
  toast.message(i18n.t(key))
}

export function formatMemoryStatusBody(sessionId: string): {
  use: string
  generate: string
  incognito: string
} | null {
  const sess = useDomainStore.getState().sessions.find((s) => s.id === sessionId)
  if (!sess) return null
  const cfg = sess.config
  return {
    use: cfg?.useMemories === undefined ? 'inherit' : String(cfg.useMemories),
    generate: cfg?.generateMemories === undefined ? 'inherit' : String(cfg.generateMemories),
    incognito: String(!!cfg?.incognito),
  }
}

export function showMemoryStatus(
  _sessionId: string,
  copy: { title: string; body: string },
): void {
  toast.message(copy.title, { description: copy.body })
}
