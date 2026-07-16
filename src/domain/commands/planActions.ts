import { toast } from 'sonner'
import i18n from '@/i18n'
import { sessionService } from '../sessionService'
import { useDomainStore } from '../sessionStore'
import { useDraftStore } from '@/store/draftStore'

/** Trailing text after `/plan` becomes the task to send under forcePlan. */
export function extractPlanTask(value: string): string | undefined {
  const m = value.match(/(?:^|\s)\/plan(?:\s+(.*))?$/i)
  const rest = m?.[1]?.trim()
  return rest || undefined
}

/**
 * Enable force-plan for the active session (or code draft before first send).
 * When `task` is provided, also start an agent turn with that message.
 */
export function runPlanOn(sessionId: string | null, task?: string): void {
  if (sessionId) {
    if (useDomainStore.getState().activeSessionId !== sessionId) {
      sessionService.selectSession(sessionId)
    }
    sessionService.setForcePlan(sessionId, true)
  } else {
    useDraftStore.getState().setForcePlan(true)
  }

  if (task?.trim()) {
    if (!sessionId) {
      // Draft + first send: configFromDraft will carry forcePlan
      sessionService.sendMessage(task.trim())
    } else {
      sessionService.sendMessage(task.trim())
    }
    return
  }

  toast.message(i18n.t('chat.plan.forceOnTitle'), {
    description: i18n.t('chat.plan.forceOnBody'),
  })
}

/** Disable force-plan for the active session (or code draft). */
export function runPlanOff(sessionId: string | null): void {
  if (sessionId) {
    sessionService.setForcePlan(sessionId, false)
  } else {
    useDraftStore.getState().setForcePlan(false)
  }
  toast.message(i18n.t('chat.plan.forceOffTitle'), {
    description: i18n.t('chat.plan.forceOffBody'),
  })
}
