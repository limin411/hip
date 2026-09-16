import { useTranslation } from 'react-i18next'
import { Clock, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useScheduledTask } from './useScheduledTask'

interface ScheduledTaskBannerProps {
  onEdit?: () => void
}

export function ScheduledTaskBanner({ onEdit }: ScheduledTaskBannerProps) {
  const { t } = useTranslation()
  const { taskInfo, deleteScheduledTask, getFrequencyText, getTimeText } = useScheduledTask()

  if (!taskInfo) {
    return null
  }

  const frequencyText = getFrequencyText(taskInfo.frequency, taskInfo.intervalMinutes, taskInfo.weekday)
  
  // For interval, show interval info; for daily/weekly, show time
  const getTimeDisplay = () => {
    if (taskInfo.frequency === 'interval') {
      return frequencyText
    }
    return `${frequencyText} ${getTimeText(taskInfo.hour, taskInfo.minute)} 执行`
  }

  return (
    <div
      className={cn(
        'mb-2 flex animate-view-enter items-center gap-2 rounded-md border border-border bg-surface-muted px-2.5 py-1.5'
      )}
      data-testid="scheduled-task-banner"
    >
      <div className="flex h-5 w-5 shrink-0 items-center justify-center text-ink-tertiary">
        <Clock size={14} strokeWidth={1.75} />
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-meta text-ink-secondary">
          {t('scheduledTask.banner.title', { frequency: getTimeDisplay(), time: '' })}
        </p>
        {taskInfo.nextRun && (
          <p className="truncate text-caption text-ink-tertiary">
            {t('scheduledTask.banner.nextRun', { time: taskInfo.nextRun })}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1">
        {onEdit && (
          <button
            type="button"
            className="rounded-sm px-1.5 py-0.5 text-meta text-ink-tertiary hover:text-ink-secondary"
            onClick={onEdit}
            data-testid="scheduled-task-banner-edit"
          >
            {t('scheduledTask.banner.edit')}
          </button>
        )}
        <button
          type="button"
          className="rounded-sm p-0.5 text-ink-tertiary hover:text-ink-secondary"
          onClick={deleteScheduledTask}
          aria-label={t('scheduledTask.banner.close')}
          data-testid="scheduled-task-banner-close"
        >
          <X size={14} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}