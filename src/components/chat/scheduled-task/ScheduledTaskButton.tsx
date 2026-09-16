import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock } from 'lucide-react'
import { toast } from 'sonner'
import { ComposerChip } from '@/components/chat/ComposerChip'
import { ScheduledTaskPopover } from './ScheduledTaskPopover'
import {
  DEFAULT_INTERVAL_MINUTES,
  DEFAULT_SCHEDULE_HOUR,
  useScheduledTask,
  type ScheduledTaskDraft,
} from './useScheduledTask'
import { useActiveSessionId } from '@/domain'

export function ScheduledTaskButton() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const activeId = useActiveSessionId()
  const { taskInfo, createScheduledTask, updateScheduledTask, deleteScheduledTask } = useScheduledTask()

  const hasTask = !!taskInfo

  // Get display label
  const getLabel = () => {
    if (!taskInfo) return undefined
    if (taskInfo.frequency === 'interval') {
      if (taskInfo.intervalMinutes >= 60) {
        return `${Math.floor(taskInfo.intervalMinutes / 60)}h`
      }
      return `${taskInfo.intervalMinutes}m`
    }
    return `${String(taskInfo.hour).padStart(2, '0')}:${String(taskInfo.minute).padStart(2, '0')}`
  }

  const label = getLabel()

  const handleClick = () => {
    if (!activeId) {
      toast.info(t('scheduledTask.toast.needSession'))
      return
    }
    setOpen(true)
  }

  const submit = (draft: ScheduledTaskDraft) => {
    if (hasTask) {
      updateScheduledTask(draft)
    } else {
      createScheduledTask(draft)
    }
    setOpen(false)
  }

  return (
    <>
      <ComposerChip
        active={hasTask}
        // A configured task is a persistent, easy-to-miss state, and the shared
        // neutral `active` tint (#e6e6e6 vs #f0f0f0 on hover) reads as "unchanged".
        // Use the accent "configured" badge treatment (matches AgentCard etc.).
        className={
          hasTask ? 'bg-accent/10 text-accent hover:bg-accent/15' : undefined
        }
        title={hasTask
          ? t('scheduledTask.tooltip.active', { time: label ?? '' })
          : t('scheduledTask.tooltip.inactive')
        }
        data-testid="scheduled-task-button"
        onClick={handleClick}
      >
        <Clock size={13} strokeWidth={1.75} className="shrink-0" aria-hidden />
        {hasTask && label && (
          <span className="max-w-[120px] truncate">{label}</span>
        )}
      </ComposerChip>

      <ScheduledTaskPopover
        open={open}
        onOpenChange={setOpen}
        initialFrequency={taskInfo?.frequency ?? 'interval'}
        initialIntervalMinutes={taskInfo?.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES}
        initialHour={taskInfo?.hour ?? DEFAULT_SCHEDULE_HOUR}
        initialMinute={taskInfo?.minute ?? 0}
        initialWeekday={taskInfo?.weekday ?? 0}
        initialPrompt={taskInfo?.prompt ?? ''}
        hasExistingTask={hasTask}
        onCreate={submit}
        onUpdate={submit}
        onDelete={() => {
          deleteScheduledTask()
          setOpen(false)
        }}
      />
    </>
  )
}
