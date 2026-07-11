import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Command } from 'cmdk'
import { ChevronLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { sessionService, useSessions } from '@/domain'
import { useCommandPaletteStore } from '@/store/commandPaletteStore'
import { useUiStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'
import {
  buildGlobalCommandGroups,
  buildThemePageGroups,
  type GlobalCommandLabels,
} from './buildGlobalCommands'
import { CommandRow } from './components/CommandRow'
import { detectIsMac } from './keys'
import { rankGroups } from './rankGlobalCommands'
import { ShortcutsHelpDialog } from './ShortcutsHelpDialog'
import type { GlobalCommand } from './types'

/**
 * Global ⌘K command palette.
 * Navigation, workspace settings, theme subpage, context actions, and search-time sessions.
 */
export function GlobalCommandPalette() {
  const { t, i18n } = useTranslation()
  const open = useCommandPaletteStore((s) => s.open)
  const setOpen = useCommandPaletteStore((s) => s.setOpen)
  const page = useCommandPaletteStore((s) => s.page)
  const setPage = useCommandPaletteStore((s) => s.setPage)
  const sessions = useSessions()
  const activeView = useUiStore((s) => s.activeView)
  const theme = useUiStore((s) => s.theme)
  const chatSessionId = useUiStore((s) => s.chatSessionId)
  const codeSessionId = useUiStore((s) => s.codeSessionId)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const setTheme = useUiStore((s) => s.setTheme)
  const setSettingsPage = useUiStore((s) => s.setSettingsPage)
  const [search, setSearch] = useState('')
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const isMac = useMemo(() => detectIsMac(), [])

  const sessionId =
    activeView === 'code' ? codeSessionId : activeView === 'chat' ? chatSessionId : null

  useEffect(() => {
    if (!open) {
      setSearch('')
      // page cleared by store on close
    }
  }, [open])

  const labels = useMemo<GlobalCommandLabels>(
    () => ({
      groupNavigation: t('commandPalette.groups.navigation'),
      groupActions: t('commandPalette.groups.actions'),
      groupTheme: t('commandPalette.groups.theme'),
      groupSessions: t('commandPalette.groups.sessions'),
      groupContext: t('commandPalette.groups.context'),
      groupWorkspace: t('commandPalette.groups.workspace'),
      groupAppearance: t('commandPalette.groups.appearance'),
      navChat: t('nav.chat'),
      navCode: t('nav.code'),
      navHistory: t('nav.history'),
      navSettings: t('nav.settings'),
      actionNewConversation: t('commandPalette.actions.newConversation'),
      actionKeyboardShortcuts: t('commandPalette.actions.keyboardShortcuts'),
      actionChangeTheme: t('commandPalette.actions.changeTheme'),
      themeLight: t('settings.themes.light'),
      themeDark: t('settings.themes.dark'),
      themeSystem: t('settings.themes.system'),
      current: t('commandPalette.current'),
      settings: {
        general: t('commandPalette.settings.general'),
        model: t('commandPalette.settings.model'),
        agents: t('commandPalette.settings.agents'),
        mcp: t('commandPalette.settings.mcp'),
        skill: t('commandPalette.settings.skill'),
        plugins: t('commandPalette.settings.plugins'),
        memory: t('commandPalette.settings.memory'),
      },
      context: {
        diff: t('commandPalette.context.diff'),
        compact: t('commandPalette.context.compact'),
        init: t('commandPalette.context.init'),
        memoryOn: t('commandPalette.context.memoryOn'),
        memoryOff: t('commandPalette.context.memoryOff'),
        memoryIncognito: t('commandPalette.context.memoryIncognito'),
        memoryStatus: t('commandPalette.context.memoryStatus'),
      },
    }),
    [t, i18n.language],
  )

  const ctx = useMemo(
    () => ({
      sessions,
      activeView,
      theme,
      labels,
      sessionId,
      setActiveView,
      setTheme,
      setSettingsPage,
      newConversation: (surface?: 'chat' | 'code') => sessionService.newConversation(surface),
      selectSession: (id: string) => sessionService.selectSession(id),
      openShortcutsHelp: () => {
        useCommandPaletteStore.getState().close()
        setShortcutsOpen(true)
      },
      memoryStatusCopy: (flags: { use: string; generate: string; incognito: string }) => ({
        title: t('chat.slash.memoryStatusTitle'),
        body: t('chat.slash.memoryStatusBody', flags),
      }),
      isMac,
    }),
    [
      sessions,
      activeView,
      theme,
      labels,
      sessionId,
      setActiveView,
      setTheme,
      setSettingsPage,
      t,
      isMac,
    ],
  )

  const groups = useMemo(() => {
    if (page === 'theme') return buildThemePageGroups(ctx)
    return buildGlobalCommandGroups(ctx, { search })
  }, [ctx, page, search])

  const visible = useMemo(() => rankGroups(groups, search), [groups, search])
  const hasItems = visible.some((g) => g.items.length > 0)

  const goBack = () => {
    setSearch('')
    setPage(null)
  }

  const handleSelect = (item: GlobalCommand) => {
    if (item.to) {
      setPage(item.to)
      setSearch('')
      return
    }
    item.run?.()
    if (!item.keepOpen) {
      useCommandPaletteStore.getState().close()
    }
  }

  const pageTitle =
    page === 'theme' ? t('commandPalette.groups.theme') : page ?? ''

  return (
    <>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[200] bg-ink/20" />
          <Dialog.Content
            aria-describedby={undefined}
            onEscapeKeyDown={(e) => {
              if (useCommandPaletteStore.getState().page) {
                e.preventDefault()
                goBack()
              }
            }}
            className={cn(
              'fixed left-1/2 top-[min(20vh,8rem)] z-[210] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2',
              'overflow-hidden rounded-xl border border-border bg-surface shadow-overlay outline-none',
              'animate-menu-in',
            )}
            data-testid="global-command-palette"
          >
            <Dialog.Title className="sr-only">{t('commandPalette.title')}</Dialog.Title>
            <Command shouldFilter={false} loop className="flex flex-col">
              {page && (
                <button
                  type="button"
                  data-testid="global-command-palette-back"
                  onClick={goBack}
                  className="flex w-full items-center gap-1.5 border-b border-border px-3 py-1.5 text-left text-caption text-ink-secondary transition-colors hover:text-ink"
                >
                  <ChevronLeft className="size-3.5" />
                  <span>{t('commandPalette.back')}</span>
                  <span className="text-ink-tertiary">/</span>
                  <span className="font-medium text-ink">{pageTitle}</span>
                </button>
              )}
              <Command.Input
                value={search}
                onValueChange={setSearch}
                onKeyDown={(e) => {
                  if (!page) return
                  if (e.key === 'Escape' || (e.key === 'Backspace' && search === '')) {
                    e.preventDefault()
                    e.stopPropagation()
                    goBack()
                  }
                }}
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
                    <div>{t('commandPalette.noResults')}</div>
                    <div className="mt-1 text-caption text-ink-tertiary">
                      {t('commandPalette.noResultsHint')}
                    </div>
                  </div>
                )}
                {visible.map((group, gi) => (
                  <Command.Group
                    key={group.heading ?? group.id ?? `group-${gi}`}
                    heading={group.heading}
                    className="px-1 py-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-tertiary"
                  >
                    {group.items.map((item) => (
                      <Command.Item
                        key={item.id}
                        value={`${item.label}\u0001${item.id}`}
                        onSelect={() => handleSelect(item)}
                        className={cn(
                          'flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-body text-ink',
                          'data-[selected=true]:bg-accent-subtle',
                        )}
                        data-testid={`global-cmd-${item.id}`}
                      >
                        <CommandRow item={item} />
                      </Command.Item>
                    ))}
                  </Command.Group>
                ))}
              </Command.List>
            </Command>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <ShortcutsHelpDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </>
  )
}
