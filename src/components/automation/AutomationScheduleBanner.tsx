import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionBanner } from '@/components/ui/ActionBanner'
import { Button } from '@/components/ui/Button'
import { useHipConfigStore } from '@/store/hipConfigStore'
import { useUiStore } from '@/store/uiStore'
import {
  resolveCloseAction,
  resolveTrayEnabled,
} from '@/ipc/windowPolicy'
import type { Automation } from '@/domain/automations'

export type AutomationScheduleBannerProps = {
  automations: Automation[]
}

/**
 * Sticky banner when any enabled scheduled automation exists but
 * close-to-quit / tray-off makes background scheduling unreliable.
 * Session-only dismiss (memory); re-evaluates each visit.
 */
export function AutomationScheduleBanner({ automations }: AutomationScheduleBannerProps) {
  const { t } = useTranslation()
  const [dismissed, setDismissed] = useState(false)
  const closeAction = resolveCloseAction(
    useHipConfigStore((s) => s.config.window?.closeAction),
  )
  const trayEnabled = resolveTrayEnabled(
    useHipConfigStore((s) => s.config.window?.trayEnabled),
  )

  const hasScheduledEnabled = useMemo(
    () => automations.some((a) => a.enabled && a.trigger.kind !== 'manual'),
    [automations],
  )

  // Unfavorable when quit-on-close or tray disabled (process may not stay alive).
  const unfavorable = closeAction === 'quit' || !trayEnabled

  if (dismissed || !hasScheduledEnabled || !unfavorable) return null

  const openWindowSettings = () => {
    useUiStore.getState().setSettingsPage('window')
    useUiStore.getState().setActiveView('settings')
  }

  return (
    <ActionBanner
      tone="warning"
      data-testid="automation-schedule-banner"
      title={t('automation.banner.needTray')}
      description={t('automation.banner.needTrayDesc')}
      actions={
        <>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-testid="automation-banner-open-settings"
            onClick={openWindowSettings}
          >
            {t('automation.banner.openWindowSettings')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            data-testid="automation-banner-dismiss"
            onClick={() => setDismissed(true)}
          >
            {t('automation.banner.dismiss')}
          </Button>
        </>
      }
    />
  )
}
