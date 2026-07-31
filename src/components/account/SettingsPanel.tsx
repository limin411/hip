import { useTranslation } from 'react-i18next'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  SETTINGS_SHELL_PAGE,
  useUiStore,
  type SettingsPageId,
} from '@/store/uiStore'
import { SETTINGS_PAGES } from './settingsNav'

/**
 * Settings main-column body. Category nav lives in the app sidebar
 * (SettingsSidebarContent) while overlay === 'settings'.
 */
export function SettingsPanel() {
  const { t } = useTranslation()
  const settingsPage = useUiStore((s) => s.settingsPage)
  const setSettingsPage = useUiStore((s) => s.setSettingsPage)
  const settingsShellRoute = useUiStore((s) => s.settingsShellRoute)
  const setSettingsShellRoute = useUiStore((s) => s.setSettingsShellRoute)
  const isL2 = settingsShellRoute.type !== 'page'

  const backBar = isL2 ? (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
      <button
        type="button"
        data-testid="settings-shell-back"
        onClick={() => setSettingsShellRoute(SETTINGS_SHELL_PAGE)}
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-body font-medium text-ink-secondary',
          'transition-colors hover:bg-state-hover hover:text-ink',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
        )}
      >
        <ArrowLeft size={16} strokeWidth={1.75} />
        {t('common.back')}
      </button>
    </div>
  ) : null

  return (
    <TabsPrimitive.Root
      orientation="vertical"
      value={settingsPage}
      onValueChange={(v) => setSettingsPage(v as SettingsPageId)}
      className="flex h-full w-full flex-col"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {backBar}
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          {SETTINGS_PAGES.map((page) => {
            const Page = page.Component
            // Full-height market pages (MCP / plugins) manage their own scroll inside
            // overflow-hidden roots so title actions stay pinned. Long form pages
            // (general, model, …) still scroll via overflow-y-auto here.
            return (
              <TabsPrimitive.Content
                key={page.id}
                value={page.id}
                className="h-full min-h-0 min-w-0 overflow-y-auto focus-visible:outline-none data-[state=active]:animate-view-enter"
              >
                <Page />
              </TabsPrimitive.Content>
            )
          })}
        </div>
      </div>
    </TabsPrimitive.Root>
  )
}
