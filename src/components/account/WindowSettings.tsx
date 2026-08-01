import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown } from 'lucide-react'
import type { WindowCloseAction } from '@hip/protocol'
import { cn } from '@/lib/utils'
import { useHipConfigStore } from '@/store/hipConfigStore'
import {
  CLOSE_ACTION_OPTIONS,
  resolveCloseAction,
  resolveTrayEnabled,
  setLaunchAtLogin,
  setWindowPolicy,
} from '@/ipc/windowPolicy'
import { Switch } from '@/components/ui/Switch'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'

const selectTriggerCls =
  'flex h-8 cursor-pointer items-center justify-between gap-6 rounded-sm border border-border bg-surface py-1.5 pl-2.5 pr-2 text-body text-ink-secondary transition-colors duration-chrome hover:bg-state-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20'

/** Settings → Basic → Window & background (standalone page). */
export function WindowSettings() {
  const { t } = useTranslation()
  const closeAction = resolveCloseAction(useHipConfigStore((s) => s.config.window?.closeAction))
  const trayEnabled = resolveTrayEnabled(useHipConfigStore((s) => s.config.window?.trayEnabled))
  const launchAtLogin = useHipConfigStore((s) => s.config.window?.launchAtLogin === true)
  const notifyOnAgentComplete = useHipConfigStore(
    (s) => s.config.window?.notifyOnAgentComplete !== false,
  )
  const updateSection = useHipConfigStore((s) => s.updateSection)
  const loadHipConfig = useHipConfigStore((s) => s.load)
  const hipLoaded = useHipConfigStore((s) => s.loaded)

  useEffect(() => {
    if (!hipLoaded) void loadHipConfig()
  }, [hipLoaded, loadHipConfig])

  const pushWindowPolicy = (
    nextClose: WindowCloseAction,
    nextTray: boolean,
    closePromptSeen = true,
  ) => {
    void setWindowPolicy(nextClose, nextTray, closePromptSeen)
  }

  const setCloseAction = (action: WindowCloseAction) => {
    const nextTray = action === 'hide' || action === 'ask' ? true : trayEnabled
    void updateSection('window', (prev) => ({
      ...(prev ?? {}),
      closeAction: action,
      trayEnabled: nextTray,
      closePromptSeen: true,
    }))
    pushWindowPolicy(action, nextTray, true)
  }

  const setTrayEnabled = (enabled: boolean) => {
    // Pair tray with close policy: enabling tray ⇒ hide-to-tray; disabling while
    // hide/ask is selected ⇒ quit (hide/ask require a tray).
    const nextClose: WindowCloseAction = enabled
      ? closeAction === 'quit'
        ? 'hide'
        : closeAction
      : closeAction === 'hide' || closeAction === 'ask'
        ? 'quit'
        : closeAction
    void updateSection('window', (prev) => ({
      ...(prev ?? {}),
      closeAction: nextClose,
      trayEnabled: enabled,
      closePromptSeen: true,
    }))
    pushWindowPolicy(nextClose, enabled, true)
  }

  const setLaunchAtLoginPref = (enabled: boolean) => {
    void updateSection('window', (prev) => ({
      ...(prev ?? {}),
      launchAtLogin: enabled,
      startHiddenOnLogin: enabled ? (prev?.startHiddenOnLogin ?? true) : prev?.startHiddenOnLogin,
    }))
    void setLaunchAtLogin(enabled)
  }

  const setNotifyOnAgentComplete = (enabled: boolean) => {
    void updateSection('window', (prev) => ({
      ...(prev ?? {}),
      notifyOnAgentComplete: enabled,
    }))
  }

  return (
    <div className="flex flex-col" data-testid="settings-page-window">
      <div className="px-8 pb-3 pt-7">
        <h2 className="text-title font-semibold tracking-tight text-ink">{t('settings.window')}</h2>
        <p className="mt-1 text-meta leading-relaxed text-ink-tertiary">{t('settings.windowDesc')}</p>
      </div>

      <div
        className="flex items-center justify-between gap-6 px-8 py-4"
        data-testid="settings-close-action"
      >
        <div className="min-w-0 flex-1">
          <div className="text-body font-medium text-ink">{t('settings.closeAction')}</div>
          <div className="mt-0.5 text-meta leading-relaxed text-ink-tertiary">
            {t('settings.closeActionDesc')}
          </div>
        </div>
        <div className="relative shrink-0">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={selectTriggerCls}
                data-testid="settings-close-action-trigger"
              >
                <span>{t(`settings.closeActions.${closeAction}`)}</span>
                <ChevronDown size={14} strokeWidth={1.75} className="shrink-0 text-ink-tertiary" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {CLOSE_ACTION_OPTIONS.map((action) => (
                <DropdownMenuItem
                  key={action}
                  data-testid={`settings-close-action-${action}`}
                  onSelect={() => setCloseAction(action)}
                >
                  <Check
                    size={14}
                    className={cn('shrink-0', closeAction === action ? 'opacity-100' : 'opacity-0')}
                  />
                  <span>{t(`settings.closeActions.${action}`)}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div
        className="flex items-center justify-between gap-6 px-8 py-4"
        data-testid="settings-tray-enabled"
      >
        <div className="min-w-0 flex-1">
          <div className="text-body font-medium text-ink">{t('settings.trayEnabled')}</div>
          <div className="mt-0.5 text-meta leading-relaxed text-ink-tertiary">
            {t('settings.trayEnabledDesc')}
          </div>
        </div>
        <Switch
          checked={trayEnabled}
          onCheckedChange={setTrayEnabled}
          ariaLabel={t('settings.trayEnabled')}
          data-testid="settings-tray-enabled-switch"
        />
      </div>

      <div
        className="flex items-center justify-between gap-6 px-8 py-4"
        data-testid="settings-launch-at-login"
      >
        <div className="min-w-0 flex-1">
          <div className="text-body font-medium text-ink">{t('settings.launchAtLogin')}</div>
          <div className="mt-0.5 text-meta leading-relaxed text-ink-tertiary">
            {t('settings.launchAtLoginDesc')}
          </div>
        </div>
        <Switch
          checked={launchAtLogin}
          onCheckedChange={setLaunchAtLoginPref}
          ariaLabel={t('settings.launchAtLogin')}
          data-testid="settings-launch-at-login-switch"
        />
      </div>

      <div
        className="flex items-center justify-between gap-6 px-8 py-4"
        data-testid="settings-notify-agent-complete"
      >
        <div className="min-w-0 flex-1">
          <div className="text-body font-medium text-ink">{t('settings.notifyOnAgentComplete')}</div>
          <div className="mt-0.5 text-meta leading-relaxed text-ink-tertiary">
            {t('settings.notifyOnAgentCompleteDesc')}
          </div>
        </div>
        <Switch
          checked={notifyOnAgentComplete}
          onCheckedChange={setNotifyOnAgentComplete}
          ariaLabel={t('settings.notifyOnAgentComplete')}
          data-testid="settings-notify-agent-complete-switch"
        />
      </div>
    </div>
  )
}
