import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Command } from 'cmdk'
import { ChevronLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { sessionService, useSessions } from '@/domain'
import { useCommandPaletteStore } from '@/store/commandPaletteStore'
import { useSkillsStore } from '@/store/skillsStore'
import { useUiStore } from '@/store/uiStore'
import {
  isKnowledgeIndexReady,
  searchKnowledgeDocs,
  useKnowledgeStore,
} from '@/store/knowledgeStore'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  buildThemePageGroups,
  type GlobalCommandLabels,
} from './buildGlobalCommands'
import { CommandRow } from './components/CommandRow'
import { PaletteFooter } from './components/PaletteFooter'
import { buildFavoritesGroup, flattenVisibleItems } from './favorites'
import { loadFavorites, toggleFavorite } from './favoritesStore'
import { flattenHotkeyItems, hotkeyIndexForId } from './hotkeyItems'
import { detectIsMac } from './keys'
import { filterGroupsByMode, parsePaletteQuery } from './queryPrefix'
import { rankGroups } from './rankGlobalCommands'
import { buildAllGroups } from './registry'
import { resolvePaletteSessionId } from './sessionResolve'
import { ShortcutsHelpDialog } from './ShortcutsHelpDialog'
import type { GlobalCommand } from './types'
import { loadCommandUsage, recordCommandUsage } from './usageStore'

/**
 * Global ⌘K command palette.
 * Navigation, workspace, theme subpage, context actions, prefixes, favorites, skills.
 */
export function GlobalCommandPalette() {
  const { t, i18n } = useTranslation()
  const open = useCommandPaletteStore((s) => s.open)
  const setOpen = useCommandPaletteStore((s) => s.setOpen)
  const page = useCommandPaletteStore((s) => s.page)
  const setPage = useCommandPaletteStore((s) => s.setPage)
  const sessions = useSessions()
  const skills = useSkillsStore((s) => s.skills)
  const skillsEnabled = useSkillsStore((s) => s.enabled)
  const activeView = useUiStore((s) => s.activeView)
  const theme = useUiStore((s) => s.theme)
  const chatSessionId = useUiStore((s) => s.chatSessionId)
  const codeSessionId = useUiStore((s) => s.codeSessionId)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const openKnowledgeView = useUiStore((s) => s.openKnowledgeView)
  const setTheme = useUiStore((s) => s.setTheme)
  const setSettingsPage = useUiStore((s) => s.setSettingsPage)
  const knowledgeIndexStatus = useKnowledgeStore((s) => s.indexStatus)
  const [search, setSearch] = useState('')
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [usageTick, setUsageTick] = useState(0)
  const [favTick, setFavTick] = useState(0)
  const isMac = useMemo(() => detectIsMac(), [])

  const sessionId = resolvePaletteSessionId(activeView, chatSessionId, codeSessionId)

  const parsed = useMemo(() => parsePaletteQuery(search), [search])

  useEffect(() => {
    if (!open) {
      setSearch('')
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
      groupSkills: t('commandPalette.groups.skills'),
      groupFavorites: t('commandPalette.groups.favorites'),
      groupKnowledge: t('commandPalette.groups.knowledge'),
      navChat: t('nav.chat'),
      navCode: t('nav.code'),
      navHistory: t('nav.history'),
      navSettings: t('nav.settings'),
      navKnowledge: t('commandPalette.navKnowledge'),
      knowledgeHome: t('commandPalette.knowledgeHome'),
      knowledgeNewDoc: t('commandPalette.knowledgeNewDoc'),
      knowledgeIndexing: t('commandPalette.knowledgeIndexing'),
      knowledgeNeedSpace: t('commandPalette.knowledgeNeedSpace'),
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
        hooks: t('commandPalette.settings.hooks'),
        memory: t('commandPalette.settings.memory'),
      },
      context: {
        diff: t('commandPalette.context.diff'),
        compact: t('commandPalette.context.compact'),
        init: t('commandPalette.context.init'),
        memoryOn: t('commandPalette.context.memoryOn'),
        memoryOff: t('commandPalette.context.memoryOff'),
        memoryIncognito: t('commandPalette.context.memoryIncognito'),
        memoryIncognitoOff: t('commandPalette.context.memoryIncognitoOff'),
        memoryStatus: t('commandPalette.context.memoryStatus'),
        needSession: t('commandPalette.context.needSession'),
        needSessionHint: t('commandPalette.context.needSessionHint'),
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
      search: parsed.needle,
      skills,
      skillsEnabled,
      openKnowledgeView: () => {
        openKnowledgeView()
        void useKnowledgeStore.getState().loadSpaces()
      },
      openKnowledgeDoc: (item: {
        spaceId: string
        docId: string
        title: string
        spaceName: string
      }) => {
        openKnowledgeView()
        void useKnowledgeStore.getState().openRecent({
          ...item,
          at: Date.now(),
        })
      },
      knowledgeOpenHome: () => {
        openKnowledgeView()
        void useKnowledgeStore.getState().openHome()
      },
      knowledgeCreateDoc: () => {
        const st = useKnowledgeStore.getState()
        if (!st.activeSpaceId || st.mode !== 'workspace') {
          toast.message(t('commandPalette.knowledgeNeedSpace'))
          return
        }
        void st.createDoc(null, t('knowledge.doc.untitled'))
      },
      searchKnowledgeDocs: (q: string) => searchKnowledgeDocs(q),
      knowledgeIndexReady: knowledgeIndexStatus === 'ready' || isKnowledgeIndexReady(),
    }),
    [
      sessions,
      activeView,
      theme,
      labels,
      sessionId,
      setActiveView,
      openKnowledgeView,
      setTheme,
      setSettingsPage,
      t,
      isMac,
      parsed.needle,
      skills,
      skillsEnabled,
      knowledgeIndexStatus,
    ],
  )

  const favoriteIds = useMemo(() => {
    void favTick
    return loadFavorites()
  }, [favTick, open])

  const groups = useMemo(() => {
    if (page === 'theme') return buildThemePageGroups(ctx)
    const built = buildAllGroups(ctx, { search, mode: parsed.mode })
    const fav = buildFavoritesGroup(built, labels.groupFavorites, favoriteIds)
    // Favorites only on root empty-all mode (not when filtering with prefix)
    if (fav && parsed.mode === 'all' && !parsed.needle && !page) {
      return [fav, ...built]
    }
    return built
  }, [ctx, page, search, parsed.mode, parsed.needle, labels.groupFavorites, favoriteIds])

  const usage = useMemo(() => {
    void usageTick
    return loadCommandUsage()
  }, [usageTick, open])

  const ranked = useMemo(
    () => rankGroups(groups, parsed.needle, { usage }),
    [groups, parsed.needle, usage],
  )

  const visible = useMemo(
    () => filterGroupsByMode(ranked, parsed.mode),
    [ranked, parsed.mode],
  )

  const flatItems = useMemo(() => flattenVisibleItems(visible), [visible])
  /** Runnable rows for ⌘1–9 (excludes nested `to`) — same list for display and keydown. */
  const hotkeyItems = useMemo(() => flattenHotkeyItems(visible), [visible])
  const hasItems = flatItems.length > 0

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
    recordCommandUsage(item.id)
    setUsageTick((n) => n + 1)
    if (!item.keepOpen) {
      useCommandPaletteStore.getState().close()
    }
  }

  // ⌘1–⌘9 run first nine hotkey-eligible rows (same order as displayed ⌘n badges).
  useEffect(() => {
    if (!open || page) return
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return
      const mod = e.metaKey || e.ctrlKey
      if (!mod || e.shiftKey || e.altKey) return
      const n = Number(e.key)
      if (!Number.isInteger(n) || n < 1 || n > 9) return
      const item = hotkeyItems[n - 1]
      if (!item) return
      e.preventDefault()
      e.stopPropagation()
      handleSelect(item)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // handleSelect closes over latest hotkeyItems via effect deps
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: rebind when list changes
  }, [open, page, hotkeyItems])

  const pageTitle =
    page === 'theme' ? t('commandPalette.groups.theme') : page ?? ''

  const highlightNeedle = parsed.needle
  const favSet = useMemo(() => new Set(favoriteIds), [favoriteIds])

  return (
    <>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[200] bg-ink/20 motion-reduce:transition-none" />
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
              'animate-menu-in motion-reduce:animate-none',
            )}
            data-testid="global-command-palette"
            role="dialog"
            aria-modal="true"
            aria-label={t('commandPalette.title')}
          >
            <Dialog.Title className="sr-only">{t('commandPalette.title')}</Dialog.Title>
            <Command shouldFilter={false} loop className="flex flex-col">
              {page && (
                <button
                  type="button"
                  data-testid="global-command-palette-back"
                  onClick={goBack}
                  aria-label={t('commandPalette.back')}
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
                aria-label={t('commandPalette.searchPlaceholder')}
                className="h-11 w-full border-b border-border bg-transparent px-4 text-body text-ink outline-none placeholder:text-ink-tertiary"
              />
              <Command.List
                className="max-h-[min(20rem,56vh)] overflow-y-auto p-1"
                aria-label={t('commandPalette.title')}
              >
                {!hasItems && (
                  <div
                    className="px-3 py-6 text-center text-meta text-ink-secondary"
                    data-testid="global-command-palette-empty"
                    role="status"
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
                    {group.items.map((item) => {
                      const idx = !page ? hotkeyIndexForId(hotkeyItems, item.id) : undefined
                      return (
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
                          <CommandRow
                            item={item}
                            search={highlightNeedle}
                            favorited={favSet.has(item.id)}
                            hotkeyIndex={idx}
                            onToggleFavorite={(id) => {
                              toggleFavorite(id)
                              setFavTick((n) => n + 1)
                            }}
                          />
                        </Command.Item>
                      )
                    })}
                  </Command.Group>
                ))}
              </Command.List>
              <PaletteFooter showBack={Boolean(page)} />
            </Command>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <ShortcutsHelpDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </>
  )
}
