import { toast } from 'sonner'
import i18n from '@/i18n'
import type { ExecutionMode } from '@hip/protocol'
import { canSelectAutopilot, resolveExecutionMode } from '@hip/protocol'
import { sessionService } from '../sessionService'
import { useDomainStore } from '../sessionStore'
import { useDraftStore } from '@/store/draftStore'

/** Trailing text after `/plan` becomes the task to send under forcePlan. */
export function extractPlanTask(value: string): string | undefined {
  const m = value.match(/(?:^|\s)\/plan(?:\s+(.*))?$/i)
  const rest = m?.[1]?.trim()
  return rest || undefined
}

function setMode(sessionId: string | null, mode: ExecutionMode): boolean {
  if (sessionId) {
    if (useDomainStore.getState().activeSessionId !== sessionId) {
      sessionService.selectSession(sessionId)
    }
    return sessionService.setExecutionMode(sessionId, mode)
  }
  return useDraftStore.getState().setExecutionMode(mode)
}

/**
 * Enable force-plan for the active session (or code draft before first send).
 * When `task` is provided, also start an agent turn with that message.
 */
export function runPlanOn(sessionId: string | null, task?: string): void {
  setMode(sessionId, 'plan')

  if (task?.trim()) {
    sessionService.sendMessage(task.trim())
    return
  }

  toast.message(i18n.t('chat.executionMode.setPlanTitle'), {
    description: i18n.t('chat.executionMode.setPlanBody'),
  })
}

/** Disable force-plan → interactive for the active session (or code draft). */
export function runPlanOff(sessionId: string | null): void {
  setMode(sessionId, 'interactive')
  toast.message(i18n.t('chat.executionMode.setInteractiveTitle'), {
    description: i18n.t('chat.executionMode.setInteractiveBody'),
  })
}

/** Switch to interactive collaboration mode. */
export function runInteractive(sessionId: string | null): void {
  setMode(sessionId, 'interactive')
  toast.message(i18n.t('chat.executionMode.setInteractiveTitle'), {
    description: i18n.t('chat.executionMode.setInteractiveBody'),
  })
}

/**
 * Enable Autopilot (requires permissionMode full). Returns false if blocked.
 */
export function runAutopilot(sessionId: string | null): boolean {
  let permissionMode: import('@hip/protocol').PermissionMode | undefined
  if (sessionId) {
    const sess = useDomainStore.getState().sessions.find((s) => s.id === sessionId)
    permissionMode = sess?.config.permissionMode
  } else {
    permissionMode = useDraftStore.getState().draft?.permissionMode
  }
  if (!canSelectAutopilot(permissionMode)) {
    toast.message(i18n.t('chat.executionMode.autopilotRequiresFullTitle'), {
      description: i18n.t('chat.executionMode.autopilotRequiresFullBody'),
    })
    return false
  }
  const ok = setMode(sessionId, 'autopilot')
  if (!ok) {
    toast.message(i18n.t('chat.executionMode.autopilotRequiresFullTitle'), {
      description: i18n.t('chat.executionMode.autopilotRequiresFullBody'),
    })
    return false
  }
  toast.message(i18n.t('chat.executionMode.setAutopilotTitle'), {
    description: i18n.t('chat.executionMode.setAutopilotBody'),
  })
  return true
}

/** Resolve current execution mode for session or draft (for UI). */
export function currentExecutionMode(sessionId: string | null): ExecutionMode {
  if (sessionId) {
    const sess = useDomainStore.getState().sessions.find((s) => s.id === sessionId)
    if (sess) return resolveExecutionMode(sess.config)
  }
  const draft = useDraftStore.getState().draft
  return resolveExecutionMode({
    executionMode: draft?.executionMode,
    forcePlan: draft?.forcePlan,
    permissionMode: draft?.permissionMode,
  })
}
