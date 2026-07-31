/**
 * Left-rail content while Settings is open: category nav + back to work surface.
 */
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SETTINGS_NAV_GROUPS } from '@/components/account/settingsNav'
import { useUiStore, type SettingsPageId } from '@/store/uiStore'
import { SIDEBAR_ACTIVE_RAIL } from './sidebarActiveRail'
import { closeOverlay } from './sidebarActions'

export function SettingsSidebarContent() {
  const { t } = useTranslation()
  const settingsPage = useUiStore((s) => s.settingsPage)
  const setSettingsPage = useUiStore((s) => s.setSettingsPage)

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="settings-sidebar">
      <div
        className="px-3 pb-1.5 pt-0 text-caption font-medium tracking-wide text-ink-tertiary"
        data-testid="settings-sidebar-heading"
      >
        {t('settings.title')}
      </div>

      <nav
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
        aria-label={t('settings.title')}
        data-testid="settings-sidebar-nav"
      >
        {SETTINGS_NAV_GROUPS.map((group, groupIndex) => (
          <div
            key={group.id}
            role="group"
            aria-labelledby={`settings-nav-group-${group.id}`}
            className={groupIndex === 0 ? undefined : 'mt-2'}
          >
            <div
              id={`settings-nav-group-${group.id}`}
              data-testid={`settings-nav-group-${group.id}`}
              className={cn(
                'px-2.5 pb-1 text-caption font-medium tracking-wide text-ink-tertiary',
                groupIndex === 0 ? 'pt-0.5' : 'pt-2',
              )}
            >
              {t(group.labelKey)}
            </div>
            <div className="flex flex-col gap-0.5">
              {group.pages.map((page) => {
                const Icon = page.icon
                const active = settingsPage === page.id
                return (
                  <button
                    key={page.id}
                    type="button"
                    data-testid={`settings-nav-${page.id}`}
                    data-no-drag
                    aria-current={active ? 'page' : undefined}
                    onClick={() => setSettingsPage(page.id as SettingsPageId)}
                    className={cn(
                      'relative flex h-[var(--row-h-sidebar)] w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-body font-medium transition-colors duration-chrome ease-out',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
                      active
                        ? SIDEBAR_ACTIVE_RAIL
                        : 'text-ink-secondary hover:bg-state-hover hover:text-ink',
                    )}
                  >
                    <Icon
                      size={16}
                      strokeWidth={1.75}
                      className={cn('shrink-0', active ? 'text-ink' : 'opacity-70')}
                      aria-hidden
                    />
                    <span className="truncate">{t(page.labelKey)}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      <div
        className="relative flex shrink-0 flex-col gap-0.5 px-1.5 pb-2 pt-1"
        data-testid="settings-sidebar-footer"
      >
        <button
          type="button"
          data-testid="settings-sidebar-back"
          data-no-drag
          onClick={() => closeOverlay()}
          className={cn(
            'flex h-[var(--row-h-sidebar)] w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-body font-medium',
            'text-ink-secondary transition-colors duration-chrome ease-out',
            'hover:bg-state-hover hover:text-ink',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
          )}
        >
          <ArrowLeft size={16} strokeWidth={1.75} className="shrink-0 opacity-70" aria-hidden />
          <span className="truncate">{t('common.back')}</span>
        </button>
      </div>
    </div>
  )
}
