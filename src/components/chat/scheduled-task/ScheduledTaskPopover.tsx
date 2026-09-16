import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/lib/utils'

interface ScheduledTaskPopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialFrequency: 'interval' | 'daily' | 'weekly'
  initialIntervalMinutes: number
  initialHour: number
  initialMinute: number
  initialWeekday: number
  hasExistingTask: boolean
  onCreate: (frequency: 'interval' | 'daily' | 'weekly', intervalMinutes: number, hour: number, minute: number, weekday?: number) => void
  onUpdate: (frequency: 'interval' | 'daily' | 'weekly', intervalMinutes: number, hour: number, minute: number, weekday?: number) => void
  onDelete: () => void
}

const INTERVAL_OPTIONS = [
  { value: 5, label: '5 分钟' },
  { value: 10, label: '10 分钟' },
  { value: 15, label: '15 分钟' },
  { value: 30, label: '30 分钟' },
  { value: 60, label: '1 小时' },
  { value: 120, label: '2 小时' },
  { value: 360, label: '6 小时' },
  { value: 720, label: '12 小时' },
  { value: 1440, label: '24 小时' },
]

export function ScheduledTaskPopover({
  open,
  onOpenChange,
  initialFrequency,
  initialIntervalMinutes,
  initialHour,
  initialMinute,
  initialWeekday,
  hasExistingTask,
  onCreate,
  onUpdate,
  onDelete,
}: ScheduledTaskPopoverProps) {
  const { t } = useTranslation()
  const [frequency, setFrequency] = useState(initialFrequency)
  const [intervalMinutes, setIntervalMinutes] = useState(initialIntervalMinutes)
  const [hour, setHour] = useState(initialHour)
  const [minute, setMinute] = useState(initialMinute)
  const [weekday, setWeekday] = useState(initialWeekday)

  const weekdays = [
    { value: 0, label: t('scheduledTask.weekday.sunday') },
    { value: 1, label: t('scheduledTask.weekday.monday') },
    { value: 2, label: t('scheduledTask.weekday.tuesday') },
    { value: 3, label: t('scheduledTask.weekday.wednesday') },
    { value: 4, label: t('scheduledTask.weekday.thursday') },
    { value: 5, label: t('scheduledTask.weekday.friday') },
    { value: 6, label: t('scheduledTask.weekday.saturday') },
  ]

  const handleSubmit = () => {
    if (hasExistingTask) {
      onUpdate(frequency, intervalMinutes, hour, minute, weekday)
    } else {
      onCreate(frequency, intervalMinutes, hour, minute, weekday)
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('scheduledTask.popover.title')}
      variant="confirm"
      footer={
        <div className="flex items-center justify-between">
          {hasExistingTask && (
            <Button
              variant="ghost"
              size="sm"
              className="text-danger hover:text-danger"
              onClick={onDelete}
            >
              {t('scheduledTask.popover.delete')}
            </Button>
          )}
          <div className={cn('flex items-center gap-2', !hasExistingTask && 'ml-auto')}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              {t('scheduledTask.popover.cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSubmit}
            >
              {hasExistingTask
                ? t('scheduledTask.popover.update')
                : t('scheduledTask.popover.create')
              }
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        {/* Frequency */}
        <div className="space-y-2">
          <label className="text-body font-medium text-ink">
            {t('scheduledTask.popover.frequency')}
          </label>
          <select
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as 'interval' | 'daily' | 'weekly')}
            className={cn(
              'h-8 w-full rounded-sm border border-border bg-surface-subtle px-3 text-body',
              'focus:border-border-strong focus:outline-none'
            )}
          >
            <option value="interval">{t('scheduledTask.frequency.interval')}</option>
            <option value="daily">{t('scheduledTask.frequency.daily')}</option>
            <option value="weekly">{t('scheduledTask.frequency.weekly')}</option>
          </select>
        </div>

        {/* Interval minutes (only for interval) */}
        {frequency === 'interval' && (
          <div className="space-y-2">
            <label className="text-body font-medium text-ink">
              {t('scheduledTask.popover.interval')}
            </label>
            <select
              value={intervalMinutes}
              onChange={(e) => setIntervalMinutes(Number(e.target.value))}
              className={cn(
                'h-8 w-full rounded-sm border border-border bg-surface-subtle px-3 text-body',
                'focus:border-border-strong focus:outline-none'
              )}
            >
              {INTERVAL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Weekday (only for weekly) */}
        {frequency === 'weekly' && (
          <div className="space-y-2">
            <label className="text-body font-medium text-ink">
              {t('scheduledTask.popover.weekday')}
            </label>
            <select
              value={weekday}
              onChange={(e) => setWeekday(Number(e.target.value))}
              className={cn(
                'h-8 w-full rounded-sm border border-border bg-surface-subtle px-3 text-body',
                'focus:border-border-strong focus:outline-none'
              )}
            >
              {weekdays.map((day) => (
                <option key={day.value} value={day.value}>
                  {day.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Time (only for daily and weekly) */}
        {frequency !== 'interval' && (
          <div className="space-y-2">
            <label className="text-body font-medium text-ink">
              {t('scheduledTask.popover.time')}
            </label>
            <div className="flex items-center gap-2">
              <select
                value={hour}
                onChange={(e) => setHour(Number(e.target.value))}
                className={cn(
                  'h-8 flex-1 rounded-sm border border-border bg-surface-subtle px-3 text-body',
                  'focus:border-border-strong focus:outline-none'
                )}
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>
                    {String(i).padStart(2, '0')}
                  </option>
                ))}
              </select>
              <span className="text-body text-ink-tertiary">:</span>
              <select
                value={minute}
                onChange={(e) => setMinute(Number(e.target.value))}
                className={cn(
                  'h-8 flex-1 rounded-sm border border-border bg-surface-subtle px-3 text-body',
                  'focus:border-border-strong focus:outline-none'
                )}
              >
                {Array.from({ length: 60 }, (_, i) => (
                  <option key={i} value={i}>
                    {String(i).padStart(2, '0')}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}