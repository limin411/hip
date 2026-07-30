import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionBanner } from '@/components/ui/ActionBanner'
import { Button } from '@/components/ui/Button'
import { openSettingsOverlay } from '@/components/layout/sidebarActions'
import { useHipConfigStore } from '@/store/hipConfigStore'
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
 *
 * Design: show when `closeAction === 'quit'` OR tray disabled. Copy also
 * nudges launch-at-login so daily/weekly jobs survive reboot when the user
 * enables hide-to-tray.
 */
export function AutomationScheduleBanner({ automations }: AutomationScheduleBannerProps) {
  const { t } = useTranslation()
  const [dismissed, setDismissed] = useState(false)
  const windowCfg = useHipConfigStore((s) => s.config.window)
  const closeAction = resolveCloseAction(windowCfg?.closeAction)
  const trayEnabled = resolveTrayEnabled(windowCfg?.trayEnabled)
  const launchAtLogin = Boolean(windowCfg?.launchAtLogin)

  const hasScheduledEnabled = useMemo(
    () => automations.some((a) => a.enabled && a.trigger.kind !== 'manual'),
    [automations],
  )

  // Unfavorable when quit-on-close or tray disabled (process may not stay alive).
  const unfavorable = closeAction === 'quit' || !trayEnabled

  if (dismissed || !hasScheduledEnabled || !unfavorable) return null

  const openWindowSettings = () => {
    openSettingsOverlay('window')
  }

  // Prefer the fuller copy when login-at-start is also off (common default).
  const description = launchAtLogin
    ? t('automation.banner.needTrayDesc')
    : t('automation.banner.needTrayDescWithLogin')

  return (
    <ActionBanner
      tone="warning"
      data-testid="automation-schedule-banner"
      title={t('automation.banner.needTray')}
      description={description}
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
