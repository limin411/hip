import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Command } from 'cmdk'
import { useTranslation } from 'react-i18next'
import { sessionService, useSessions } from '@/domain'
import { useCommandPaletteStore } from '@/store/commandPaletteStore'
import { useUiStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'
import {
  buildGlobalCommandGroups,
  type GlobalCommandLabels,
} from './buildGlobalCommands'
import { rankGroups } from './rankGlobalCommands'

/**
 * Global ⌘K command palette.
 * Navigation, theme, new conversation, and recent sessions.
 */
export function GlobalCommandPalette() {
  const { t } = useTranslation()
  const open = useCommandPaletteStore((s) => s.open)
  const setOpen = useCommandPaletteStore((s) => s.setOpen)
  const sessions = useSessions()
  const activeView = useUiStore((s) => s.activeView)
  const theme = useUiStore((s) => s.theme)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const setTheme = useUiStore((s) => s.setTheme)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!open) setSearch('')
  }, [open])

  const labels = useMemo<GlobalCommandLabels>(
    () => ({
      groupNavigation: t('commandPalette.groups.navigation'),
      groupActions: t('commandPalette.groups.actions'),
      groupTheme: t('commandPalette.groups.theme'),
      groupSessions: t('commandPalette.groups.sessions'),
      navChat: t('nav.chat'),
      navCode: t('nav.code'),
      navHistory: t('nav.history'),
      navSettings: t('nav.settings'),
      actionNewConversation: t('commandPalette.actions.newConversation'),
      themeLight: t('settings.themes.light'),
      themeDark: t('settings.themes.dark'),
      themeSystem: t('settings.themes.system'),
    }),
    [t],
  )

  const groups = useMemo(
    () =>
      buildGlobalCommandGroups({
        sessions,
        activeView,
        theme,
        labels,
        setActiveView,
        setTheme,
        newConversation: (surface) => sessionService.newConversation(surface),
        selectSession: (id) => sessionService.selectSession(id),
      }),
    [sessions, activeView, theme, labels, setActiveView, setTheme],
  )

  const visible = useMemo(() => rankGroups(groups, search), [groups, search])
  const hasItems = visible.some((g) => g.items.length > 0)

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-ink/20" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            'fixed left-1/2 top-[min(20vh,8rem)] z-[210] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2',
            'overflow-hidden rounded-xl border border-border bg-surface shadow-overlay outline-none',
            'animate-menu-in',
          )}
          data-testid="global-command-palette"
        >
          <Dialog.Title className="sr-only">{t('commandPalette.title')}</Dialog.Title>
          <Command shouldFilter={false} className="flex flex-col">
            <Command.Input
              value={search}
              onValueChange={setSearch}
              placeholder={t('commandPalette.searchPlaceholder')}
              data-testid="global-command-palette-input"
              className="h-11 w-full border-b border-border bg-transparent px-4 text-body text-ink outline-none placeholder:text-ink-tertiary"
            />
            <Command.List className="max-h-[min(20rem,56vh)] overflow-y-auto p-1">
              {!hasItems && (
                <div
                  className="px-3 py-6 text-center text-meta text-ink-secondary"
                  data-testid="global-command-palette-empty"
                >
                  {t('commandPalette.noResults')}
                </div>
              )}
              {visible.map((group, gi) => (
                <Command.Group
                  key={group.heading ?? `group-${gi}`}
                  heading={group.heading}
                  className="px-1 py-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-tertiary"
                >
                  {group.items.map((item) => (
                    <Command.Item
                      key={item.id}
                      value={`${item.label}\u0001${item.id}`}
                      onSelect={() => {
                        item.run()
                        useCommandPaletteStore.getState().close()
                      }}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-body text-ink',
                        'data-[selected=true]:bg-accent-subtle',
                      )}
                      data-testid={`global-cmd-${item.id}`}
                    >
                      <span className="truncate">{item.label}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
