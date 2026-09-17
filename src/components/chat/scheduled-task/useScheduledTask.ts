import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAutomationStore } from '@/store/automationStore'
import { useActiveSessionId, useActiveSession } from '@/domain'
// Narrow import (not the `@/domain/automations` barrel) so the composer does not
// pull buildSessionConfig's store/IPC graph into every render.
import { computeNextRunAt } from '@/domain/automations/schedule'
import type { Automation, AutomationTrigger } from '@/domain/automations'

export type ScheduledTaskFrequency = 'interval' | 'daily' | 'weekly'

/** What the composer popover collects — maps 1:1 onto an {@link AutomationTrigger}. */
export interface ScheduledTaskDraft {
  frequency: ScheduledTaskFrequency
  intervalMinutes: number
  hour: number
  minute: number
  weekday?: number
  /** Free text describing what the task should do — becomes the automation prompt. */
  prompt: string
}

export interface ScheduledTaskInfo extends ScheduledTaskDraft {
  id: string
  nextRun?: string
  bannerDismissed: boolean
}

export const DEFAULT_INTERVAL_MINUTES = 30
export const DEFAULT_SCHEDULE_HOUR = 9

const DISMISSED_KEY = 'scheduledTaskDismissed'

function readDismissed(): Record<string, boolean> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) || '{}')
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    return raw as Record<string, boolean>
  } catch {
    return {}
  }
}

function writeDismissed(next: Record<string, boolean>): void {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(next))
  } catch {
    // Private-mode / quota failures must not break the composer.
  }
}

function buildTrigger(draft: ScheduledTaskDraft): AutomationTrigger {
  if (draft.frequency === 'interval') {
    return {
      kind: 'interval',
      intervalMinutes: draft.intervalMinutes || DEFAULT_INTERVAL_MINUTES,
    }
  }
  if (draft.frequency === 'weekly') {
    return {
      kind: 'weekly',
      weekday: draft.weekday ?? 0,
      hour: draft.hour,
      minute: draft.minute,
    }
  }
  return { kind: 'daily', hour: draft.hour, minute: draft.minute }
}

/**
 * Project path a task inherits from the conversation that owns it.
 *
 * The fire's surface is derived from this path alone — a task recorded without
 * it runs as a chat no matter which scene it was configured in. Written on both
 * create and update so rows saved before this field existed heal on next edit.
 */
function ownerProjectPath(owner: { config: { cwd?: string } } | null): string | null {
  return owner?.config.cwd?.trim() || null
}

export function useScheduledTask() {
  const { t } = useTranslation()
  const activeId = useActiveSessionId()
  const activeSession = useActiveSession()
  const automations = useAutomationStore((s) => s.automations)
  // Track dismissed state to trigger re-renders
  const [dismissedIds, setDismissedIds] = useState<Record<string, boolean>>(readDismissed)

  /**
   * The scheduled task **owned by the active conversation**.
   * Automations are a global catalog — matching on `sessionId` is what keeps one
   * conversation's task from showing up (and being edited/deleted) in every other one.
   */
  const scheduledTask = useMemo(() => {
    if (!activeId) return undefined
    return automations.find((a) => a.sessionId === activeId && a.enabled)
  }, [activeId, activeSession, automations])

  // Get frequency display text
  const getFrequencyText = useCallback(
    (frequency: ScheduledTaskFrequency, intervalMinutes?: number, weekday?: number) => {
      switch (frequency) {
        case 'interval': {
          const minutes = intervalMinutes || DEFAULT_INTERVAL_MINUTES
          if (minutes >= 60) {
            const hours = Math.floor(minutes / 60)
            return `${t('scheduledTask.frequency.interval')} ${hours} ${t('scheduledTask.unit.hours')}`
          }
          return `${t('scheduledTask.frequency.interval')} ${minutes} ${t('scheduledTask.unit.minutes')}`
        }
        case 'daily':
          return t('scheduledTask.frequency.daily')
        case 'weekly': {
          const days = [
            t('scheduledTask.weekday.sunday'),
            t('scheduledTask.weekday.monday'),
            t('scheduledTask.weekday.tuesday'),
            t('scheduledTask.weekday.wednesday'),
            t('scheduledTask.weekday.thursday'),
            t('scheduledTask.weekday.friday'),
            t('scheduledTask.weekday.saturday'),
          ]
          return `${t('scheduledTask.frequency.weekly')} ${days[weekday ?? 0]}`
        }
        default:
          return frequency
      }
    },
    [t],
  )

  // Get time display text
  const getTimeText = useCallback((hour: number, minute: number) => {
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  }, [])

  /**
   * Next fire time. Prefers the catalog's authoritative `nextRunAt` (the host
   * fires from it) and only falls back to recomputing when it is missing.
   */
  const getNextRun = useCallback((task: Automation): Date | undefined => {
    const ms = task.nextRunAt ?? computeNextRunAt(task.trigger, Date.now())
    if (ms == null || !Number.isFinite(ms)) return undefined
    return new Date(ms)
  }, [])

  // Dismiss banner
  const dismissBanner = useCallback(() => {
    if (!scheduledTask) return
    const newDismissed = { ...dismissedIds, [scheduledTask.id]: true }
    setDismissedIds(newDismissed)
    writeDismissed(newDismissed)
  }, [scheduledTask, dismissedIds])

  // Clear dismissed state
  const clearDismissed = useCallback((taskId: string) => {
    const newDismissed = { ...dismissedIds }
    delete newDismissed[taskId]
    setDismissedIds(newDismissed)
    writeDismissed(newDismissed)
  }, [dismissedIds])

  /** Human-readable summary used for the toast + generated automation name. */
  const describe = useCallback(
    (draft: ScheduledTaskDraft) => {
      return draft.frequency === 'interval'
        ? getFrequencyText('interval', draft.intervalMinutes)
        : `${getFrequencyText(draft.frequency, draft.intervalMinutes, draft.weekday)} ${getTimeText(draft.hour, draft.minute)}`
    },
    [getFrequencyText, getTimeText],
  )

  // Create scheduled task
  const createScheduledTask = useCallback(
    (draft: ScheduledTaskDraft) => {
      if (!activeId) return

      const summary = describe(draft)
      // Session title disambiguates the generated name — the catalog enforces
      // unique names, so two conversations must not both mint "每 30 分钟".
      const sessionLabel = activeSession?.title?.trim()
      const taskName = sessionLabel
        ? `${t('scheduledTask.defaultName', { frequency: summary })} · ${sessionLabel}`
        : t('scheduledTask.defaultName', { frequency: summary })

      void Promise.resolve(
        useAutomationStore.getState().create({
          name: taskName,
          prompt: draft.prompt,
          trigger: buildTrigger(draft),
          enabled: true,
          sessionId: activeId,
          // The fire must land in this conversation's own scene. A project
          // conversation runs its task inside that project (code surface),
          // not in Chats.
          projectPath: ownerProjectPath(activeSession),
        }),
      ).then(
        () => toast.success(t('scheduledTask.toast.created'), { description: summary }),
        (err: unknown) =>
          toast.error(t('scheduledTask.toast.failed'), {
            description: err instanceof Error ? err.message : String(err),
          }),
      )
    },
    [activeId, activeSession, t, describe],
  )

  // Update scheduled task
  const updateScheduledTask = useCallback(
    (draft: ScheduledTaskDraft) => {
      if (!scheduledTask || !activeId) return

      const summary = describe(draft)
      const sessionLabel = activeSession?.title?.trim()
      const taskName = sessionLabel
        ? `${t('scheduledTask.defaultName', { frequency: summary })} · ${sessionLabel}`
        : t('scheduledTask.defaultName', { frequency: summary })

      void Promise.resolve(
        useAutomationStore.getState().update(scheduledTask.id, {
          name: taskName,
          prompt: draft.prompt,
          trigger: buildTrigger(draft),
          // Re-recorded on edit: a row persisted before the field existed (or
          // after the conversation was rebound) heals here instead of staying
          // stuck firing into Chats.
          projectPath: ownerProjectPath(activeSession),
        }),
      ).then(
        () => toast.success(t('scheduledTask.toast.updated'), { description: summary }),
        (err: unknown) =>
          toast.error(t('scheduledTask.toast.failed'), {
            description: err instanceof Error ? err.message : String(err),
          }),
      )

      clearDismissed(scheduledTask.id)
    },
    [scheduledTask, activeId, activeSession, t, describe, clearDismissed],
  )

  // Delete scheduled task
  const deleteScheduledTask = useCallback(() => {
    if (!scheduledTask) return
    const id = scheduledTask.id
    void Promise.resolve(useAutomationStore.getState().remove(id)).then(
      () => {
        clearDismissed(id)
        toast.success(t('scheduledTask.toast.deleted'))
      },
      (err: unknown) =>
        toast.error(t('scheduledTask.toast.failed'), {
          description: err instanceof Error ? err.message : String(err),
        }),
    )
  }, [scheduledTask, t, clearDismissed])

  // Get task info
  const taskInfo = useMemo((): ScheduledTaskInfo | undefined => {
    if (!scheduledTask) return undefined

    const trigger = scheduledTask.trigger
    if (trigger.kind === 'manual') return undefined

    const nextRun = getNextRun(scheduledTask)

    return {
      id: scheduledTask.id,
      frequency: trigger.kind,
      intervalMinutes:
        trigger.kind === 'interval' ? trigger.intervalMinutes : DEFAULT_INTERVAL_MINUTES,
      hour: trigger.kind === 'interval' ? DEFAULT_SCHEDULE_HOUR : trigger.hour,
      minute: trigger.kind === 'interval' ? 0 : trigger.minute,
      weekday: trigger.kind === 'weekly' ? trigger.weekday : undefined,
      prompt: scheduledTask.prompt,
      nextRun: nextRun ? nextRun.toLocaleString() : undefined,
      bannerDismissed: !!dismissedIds[scheduledTask.id],
    }
  }, [scheduledTask, getNextRun, dismissedIds])

  return {
    taskInfo,
    scheduledTask,
    createScheduledTask,
    updateScheduledTask,
    deleteScheduledTask,
    dismissBanner,
    clearDismissed,
    getFrequencyText,
    getTimeText,
    getNextRun,
  }
}
