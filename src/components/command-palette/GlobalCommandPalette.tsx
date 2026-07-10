import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Command } from 'cmdk'
import { useTranslation } from 'react-i18next'
import { useCommandPaletteStore } from '@/store/commandPaletteStore'
import { cn } from '@/lib/utils'
import { buildGlobalCommandGroups } from './buildGlobalCommands'
import { rankGroups } from './rankGlobalCommands'

/**
 * Global ⌘K command palette shell.
 * Groups/actions land in PR-5/6; this ships Dialog + cmdk + empty state only.
 */
export function GlobalCommandPalette() {
  const { t } = useTranslation()
  const open = useCommandPaletteStore((s) => s.open)
  const setOpen = useCommandPaletteStore((s) => s.setOpen)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!open) setSearch('')
  }, [open])

  // Skeleton context: empty until PR-5 wires real actions.
  const groups = useMemo(
    () =>
      buildGlobalCommandGroups({
        sessions: [],
        activeView: 'chat',
        theme: 'system',
        setActiveView: () => {},
        setTheme: () => {},
        newConversation: () => {},
        selectSession: () => {},
      }),
    [],
  )

  const visible = useMemo(() => rankGroups(groups, search), [groups, search])

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
              {visible.length === 0 && (
                <div
                  className="px-3 py-6 text-center text-meta text-ink-secondary"
                  data-testid="global-command-palette-empty"
                >
                  {search.trim()
                    ? t('commandPalette.noResults')
                    : t('commandPalette.emptyHint')}
                </div>
              )}
              {visible.map((group, gi) => (
                <Command.Group
                  key={group.heading ?? `group-${gi}`}
                  heading={group.heading}
                  className="px-1 py-1 text-caption text-ink-tertiary"
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
