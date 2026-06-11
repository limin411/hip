import { useTranslation } from 'react-i18next'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { GeneralSettings } from './GeneralSettings'

const PAGES = [
  { id: 'general', icon: SlidersHorizontal, labelKey: 'settings.general', Component: GeneralSettings },
] as const

export function SettingsPanel() {
  const { t } = useTranslation()

  return (
    <TabsPrimitive.Root
      orientation="vertical"
      defaultValue="general"
      className="flex max-h-[70vh] min-h-[400px]"
    >
      <TabsPrimitive.List
        aria-label={t('settings.title')}
        className="flex w-[168px] shrink-0 flex-col gap-1 border-r border-border bg-surface-subtle p-2"
      >
        {PAGES.map((page) => {
          const Icon = page.icon
          return (
            <TabsPrimitive.Trigger
              key={page.id}
              value={page.id}
              className={cn(
                'flex items-center gap-2 rounded-md px-2.5 py-2 text-body transition-colors',
                'text-ink-secondary hover:bg-surface-muted',
                'data-[state=active]:bg-accent-active data-[state=active]:font-medium data-[state=active]:text-accent-strong',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
              )}
            >
              <Icon size={16} className="shrink-0" />
              {t(page.labelKey)}
            </TabsPrimitive.Trigger>
          )
        })}
      </TabsPrimitive.List>

      {PAGES.map((page) => {
        const Page = page.Component
        return (
          <TabsPrimitive.Content
            key={page.id}
            value={page.id}
            className="min-w-0 flex-1 overflow-y-auto focus-visible:outline-none"
          >
            <Page />
          </TabsPrimitive.Content>
        )
      })}
    </TabsPrimitive.Root>
  )
}
