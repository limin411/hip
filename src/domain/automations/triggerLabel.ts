import type { AutomationTrigger } from './types'

/** Translator surface — matches the `t` passed by the automation UI helpers. */
export type TriggerLabelTranslator = (
  key: string,
  opts?: Record<string, unknown>,
) => string

/**
 * One-line human-readable schedule label for an {@link AutomationTrigger}.
 *
 * `interval` must be handled **before** reading `hour`/`minute`: interval
 * triggers carry no wall-clock fields, so a shared "time" line renders
 * `undefined:undefined` for them.
 */
export function automationTriggerLabel(
  trigger: AutomationTrigger,
  t: TriggerLabelTranslator,
): string {
  if (trigger.kind === 'manual') return t('automation.trigger.manual')

  if (trigger.kind === 'interval') {
    const minutes = trigger.intervalMinutes
    if (minutes >= 60 && minutes % 60 === 0) {
      return t('automation.trigger.intervalHoursAt', { hours: minutes / 60 })
    }
    return t('automation.trigger.intervalAt', { minutes })
  }

  const time = `${String(trigger.hour).padStart(2, '0')}:${String(trigger.minute).padStart(2, '0')}`
  if (trigger.kind === 'daily') {
    return t('automation.trigger.dailyAt', { time })
  }

  const wd = ((trigger.weekday % 7) + 7) % 7
  return t('automation.trigger.weeklyAt', {
    weekday: t(`automation.weekday.${wd}`),
    time,
  })
}
