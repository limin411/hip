import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock } from 'lucide-react'
import { toast } from 'sonner'
import { ComposerChip } from '@/components/chat/ComposerChip'
import { ScheduledTaskPopover } from './ScheduledTaskPopover'
import { useScheduledTask } from './useScheduledTask'
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

  return (
    <>
      <ComposerChip
        active={hasTask}
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
        initialIntervalMinutes={taskInfo?.intervalMinutes ?? 30}
        initialHour={taskInfo?.hour ?? 9}
        initialMinute={taskInfo?.minute ?? 0}
        initialWeekday={taskInfo?.weekday ?? 0}
        hasExistingTask={hasTask}
        onCreate={(frequency, intervalMinutes, hour, minute, weekday) => {
          createScheduledTask(frequency, intervalMinutes, hour, minute, weekday)
          setOpen(false)
        }}
        onUpdate={(frequency, intervalMinutes, hour, minute, weekday) => {
          updateScheduledTask(frequency, intervalMinutes, hour, minute, weekday)
          setOpen(false)
        }}
        onDelete={() => {
          deleteScheduledTask()
          setOpen(false)
        }}
      />
    </>
  )
}