import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAutomationStore } from '@/store/automationStore'
import { useActiveSessionId, useActiveSession } from '@/domain'
import type { Automation, AutomationTrigger } from '@/domain/automations'

export interface ScheduledTaskInfo {
  id: string
  frequency: 'interval' | 'daily' | 'weekly'
  intervalMinutes: number
  hour: number
  minute: number
  weekday?: number
  nextRun?: string
  bannerDismissed: boolean
}

const DEFAULT_INTERVAL_MINUTES = 30

export function useScheduledTask() {
  const { t } = useTranslation()
  const activeId = useActiveSessionId()
  const activeSession = useActiveSession()
  const automations = useAutomationStore((s) => s.automations)
  // Track dismissed state to trigger re-renders
  const [dismissedIds, setDismissedIds] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem('scheduledTaskDismissed') || '{}')
    } catch {
      return {}
    }
  })

  // Find scheduled task for current session
  const scheduledTask = useMemo(() => {
    if (!activeId || !activeSession) return undefined
    return Object.values(automations).find(
      (a) => a.enabled
    )
  }, [activeId, activeSession, automations])

  // Get frequency display text
  const getFrequencyText = useCallback((frequency: string, intervalMinutes?: number, weekday?: number) => {
    switch (frequency) {
      case 'interval':
        if (intervalMinutes && intervalMinutes >= 60) {
          const hours = Math.floor(intervalMinutes / 60)
          return `每 ${hours} 小时`
        }
        return `每 ${intervalMinutes ?? DEFAULT_INTERVAL_MINUTES} 分钟`
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
  }, [t])

  // Get time display text
  const getTimeText = useCallback((hour: number, minute: number) => {
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  }, [])

  // Get next run time
  const getNextRun = useCallback((task: Automation) => {
    const trigger = task.trigger
    const now = new Date()

    if (trigger.kind === 'interval') {
      const nextRun = new Date(now.getTime() + trigger.intervalMinutes * 60_000)
      return nextRun
    }

    if (trigger.kind === 'daily') {
      let nextRun = new Date()
      nextRun.setHours(trigger.hour, trigger.minute, 0, 0)
      if (nextRun <= now) {
        nextRun.setDate(nextRun.getDate() + 1)
      }
      return nextRun
    }

    if (trigger.kind === 'weekly') {
      const targetDay = trigger.weekday
      const currentDay = now.getDay()
      let daysUntil = targetDay - currentDay
      if (daysUntil < 0 || (daysUntil === 0 && now.getHours() * 60 + now.getMinutes() >= trigger.hour * 60 + trigger.minute)) {
        daysUntil += 7
      }
      const nextRun = new Date(now)
      nextRun.setDate(now.getDate() + daysUntil)
      nextRun.setHours(trigger.hour, trigger.minute, 0, 0)
      return nextRun
    }

    return undefined
  }, [])

  // Dismiss banner
  const dismissBanner = useCallback(() => {
    if (!scheduledTask) return
    const newDismissed = { ...dismissedIds, [scheduledTask.id]: true }
    setDismissedIds(newDismissed)
    localStorage.setItem('scheduledTaskDismissed', JSON.stringify(newDismissed))
  }, [scheduledTask, dismissedIds])

  // Check if banner is dismissed
  const isBannerDismissed = useCallback((taskId: string) => {
    return !!dismissedIds[taskId]
  }, [dismissedIds])

  // Clear dismissed state
  const clearDismissed = useCallback((taskId: string) => {
    const newDismissed = { ...dismissedIds }
    delete newDismissed[taskId]
    setDismissedIds(newDismissed)
    localStorage.setItem('scheduledTaskDismissed', JSON.stringify(newDismissed))
  }, [dismissedIds])

  // Create scheduled task
  const createScheduledTask = useCallback((
    frequency: 'interval' | 'daily' | 'weekly',
    intervalMinutes: number,
    hour: number,
    minute: number,
    weekday?: number,
    name?: string
  ) => {
    if (!activeId) return

    let trigger: AutomationTrigger
    if (frequency === 'interval') {
      trigger = { kind: 'interval', intervalMinutes: intervalMinutes || DEFAULT_INTERVAL_MINUTES }
    } else if (frequency === 'weekly') {
      trigger = { kind: 'weekly', weekday: weekday ?? 0, hour, minute }
    } else {
      trigger = { kind: 'daily', hour, minute }
    }

    const taskName = name || t('scheduledTask.defaultName', { 
      frequency: getFrequencyText(frequency, intervalMinutes, weekday),
      time: frequency === 'interval' ? '' : getTimeText(hour, minute)
    })

    const store = useAutomationStore.getState()
    store.create({
      name: taskName,
      prompt: '',
      trigger,
      enabled: true,
    })

    if (scheduledTask) {
      clearDismissed(scheduledTask.id)
    }

    // Show success toast
    const desc = frequency === 'interval'
      ? `每 ${intervalMinutes} 分钟`
      : `${getFrequencyText(frequency, intervalMinutes, weekday)} ${getTimeText(hour, minute)}`
    toast.success(t('scheduledTask.toast.created'), { description: desc })
  }, [activeId, t, getFrequencyText, getTimeText, scheduledTask, clearDismissed])

  // Update scheduled task
  const updateScheduledTask = useCallback((
    frequency: 'interval' | 'daily' | 'weekly',
    intervalMinutes: number,
    hour: number,
    minute: number,
    weekday?: number
  ) => {
    if (!scheduledTask || !activeId) return

    let trigger: AutomationTrigger
    if (frequency === 'interval') {
      trigger = { kind: 'interval', intervalMinutes: intervalMinutes || DEFAULT_INTERVAL_MINUTES }
    } else if (frequency === 'weekly') {
      trigger = { kind: 'weekly', weekday: weekday ?? 0, hour, minute }
    } else {
      trigger = { kind: 'daily', hour, minute }
    }

    const taskName = t('scheduledTask.defaultName', { 
      frequency: getFrequencyText(frequency, intervalMinutes, weekday),
      time: frequency === 'interval' ? '' : getTimeText(hour, minute)
    })

    useAutomationStore.getState().update(scheduledTask.id, {
      name: taskName,
      trigger,
    })

    clearDismissed(scheduledTask.id)

    // Show success toast
    const desc = frequency === 'interval'
      ? `每 ${intervalMinutes} 分钟`
      : `${getFrequencyText(frequency, intervalMinutes, weekday)} ${getTimeText(hour, minute)}`
    toast.success(t('scheduledTask.toast.updated'), { description: desc })
  }, [scheduledTask, activeId, t, getFrequencyText, getTimeText, clearDismissed])

  // Delete scheduled task
  const deleteScheduledTask = useCallback(() => {
    if (!scheduledTask) return
    useAutomationStore.getState().remove(scheduledTask.id)
    toast.success(t('scheduledTask.toast.deleted'))
  }, [scheduledTask, t])

  // Get task info
  const taskInfo = useMemo((): ScheduledTaskInfo | undefined => {
    if (!scheduledTask) return undefined

    const trigger = scheduledTask.trigger
    const nextRun = getNextRun(scheduledTask)
    const dismissed = isBannerDismissed(scheduledTask.id)

    return {
      id: scheduledTask.id,
      frequency: trigger.kind,
      intervalMinutes: trigger.kind === 'interval' ? trigger.intervalMinutes : DEFAULT_INTERVAL_MINUTES,
      hour: trigger.kind !== 'interval' ? trigger.hour : 0,
      minute: trigger.kind !== 'interval' ? trigger.minute : 0,
      weekday: trigger.kind === 'weekly' ? trigger.weekday : undefined,
      nextRun: nextRun ? nextRun.toLocaleString() : undefined,
      bannerDismissed: dismissed,
    }
  }, [scheduledTask, getNextRun, isBannerDismissed])

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