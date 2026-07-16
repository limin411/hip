import { useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, Code2, MessageSquare, Plus, Search } from 'lucide-react'
import { useActiveSessionId, useSessions } from '@/domain'
import { surfaceOf } from '@/lib/sessions'
import { cn } from '@/lib/utils'
import { useWindowDrag } from '@/lib/useWindowDrag'
import { useCommandPaletteStore } from '@/store/commandPaletteStore'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { useUiStore, type SidebarSection } from '@/store/uiStore'
import { DeclarativeContextMenu } from '@/components/context-menu'
import {
  enterKnowledge,
  enterSection,
  leaveKnowledge,
  newConversationFromSidebar,
  openHistoryFromChrome,
  openSettingsFromChrome,
  openSpaceFromSidebar,
  selectSessionFromSidebar,
} from './sidebarActions'
import { SidebarAccountFooter } from './SidebarAccountFooter'

function isMacMod(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)
}

interface AppSidebarProps {
  onLogout: () => void
}

export function AppSidebar({ onLogout }: AppSidebarProps) {
  const { t } = useTranslation()
  const handlePointerDown = useWindowDrag()
  const [query, setQuery] = useState('')
  const sidebarSection = useUiStore((s) => s.sidebarSection)
  const activeView = useUiStore((s) => s.activeView)
  const sessions = useSessions()
  const activeSessionId = useActiveSessionId()
  const spaces = useKnowledgeStore((s) => s.spaces)
  const activeSpaceId = useKnowledgeStore((s) => s.activeSpaceId)
  const mod = isMacMod() ? '⌘' : 'Ctrl+'

  const q = query.trim().toLowerCase()

  const filteredSessions = useMemo(() => {
    const surface = sidebarSection === 'projects' ? 'code' : 'chat'
    if (sidebarSection !== 'projects' && sidebarSection !== 'chats') return []
    let list = sessions
      .filter((s) => surfaceOf(s.config) === surface)
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
    if (q) {
      list = list.filter(
        (s) => s.title.toLowerCase().includes(q) || s.preview.toLowerCase().includes(q),
      )
    }
    return list
  }, [sessions, sidebarSection, q])

  const filteredSpaces = useMemo(() => {
    if (sidebarSection !== 'knowledge') return []
    let list = [...spaces]
    if (q) list = list.filter((sp) => sp.name.toLowerCase().includes(q))
    return list
  }, [spaces, sidebarSection, q])

  const onNav = (section: SidebarSection) => {
    if (section === 'knowledge') void enterKnowledge()
    else void enterSection(section)
  }

  const onNew = (surface: 'chat' | 'code', e: MouseEvent) => {
    e.stopPropagation()
    void newConversationFromSidebar(surface)
  }

  const listLabel =
    sidebarSection === 'knowledge'
      ? t('sidebar.list.spaces')
      : sidebarSection === 'projects'
        ? t('sidebar.list.projects')
        : t('sidebar.list.chats')

  return (
    <aside
      className="flex h-full w-[260px] shrink-0 flex-col border-r border-border bg-surface-subtle"
      data-testid="app-sidebar"
      aria-label={t('sidebar.aria')}
    >
      {/* Drag region + macOS traffic-light clearance (no fake lights in production) */}
      <div
        data-tauri-drag-region
        data-testid="sidebar-drag-region"
        onPointerDown={handlePointerDown}
        className="flex h-10 shrink-0 items-center"
      >
        <div
          className="shrink-0"
          style={{ width: 'var(--titlebar-lights-inset, 90px)' }}
          aria-hidden
        />
      </div>

      <div className="shrink-0 px-3 pb-2">
        <label htmlFor="sidebar-search-input" className="sr-only">
          {t('sidebar.searchPlaceholder')}
        </label>
        <div
          className={cn(
            'flex h-[34px] items-center gap-2 rounded-lg border border-border bg-surface px-2.5',
            'focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20',
          )}
        >
          <Search size={14} className="shrink-0 text-ink-tertiary" aria-hidden />
          <input
            id="sidebar-search-input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('sidebar.searchPlaceholder')}
            data-testid="sidebar-search"
            data-no-drag
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-tertiary"
          />
          <button
            type="button"
            data-testid="sidebar-search-palette"
            data-no-drag
            title={t('commandPalette.openTrigger')}
            aria-label={t('commandPalette.openTriggerAria')}
            onClick={() => useCommandPaletteStore.getState().setOpen(true)}
            className="shrink-0 rounded border border-border bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] text-ink-tertiary transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {mod}K
          </button>
        </div>
      </div>

      <nav className="flex shrink-0 flex-col gap-0.5 border-b border-border px-2 pb-2" aria-label={t('sidebar.navAria')}>
        <NavItem
          section="knowledge"
          active={sidebarSection === 'knowledge'}
          label={t('sidebar.nav.knowledge')}
          icon={<BookOpen size={16} />}
          count={spaces.length > 0 ? spaces.length : undefined}
          onClick={() => onNav('knowledge')}
        />
        <NavItem
          section="projects"
          active={sidebarSection === 'projects'}
          label={t('sidebar.nav.projects')}
          icon={<Code2 size={16} />}
          onClick={() => onNav('projects')}
          onNew={(e) => onNew('code', e)}
          newLabel={t('sidebar.newProject')}
        />
        <NavItem
          section="chats"
          active={sidebarSection === 'chats'}
          label={t('sidebar.nav.chats')}
          icon={<MessageSquare size={16} />}
          onClick={() => onNav('chats')}
          onNew={(e) => onNew('chat', e)}
          newLabel={t('sidebar.newChat')}
        />
      </nav>

      <div
        className="min-h-0 flex-1 overflow-y-auto px-2 py-2"
        data-testid="sidebar-list"
        role="region"
        aria-label={listLabel}
      >
        <div className="mb-1 flex items-center justify-between px-2">
          <span
            id="sidebar-list-heading"
            className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary"
          >
            {listLabel}
          </span>
          {sidebarSection === 'knowledge' ? (
            <button
              type="button"
              data-testid="sidebar-manage-spaces"
              data-no-drag
              onClick={() => void enterKnowledge()}
              className="rounded px-1 py-0.5 text-[11px] text-ink-tertiary transition-colors hover:bg-state-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              {t('sidebar.manageSpaces')}
            </button>
          ) : (
            <button
              type="button"
              data-testid="sidebar-view-all"
              data-no-drag
              onClick={() => void openHistoryFromChrome()}
              className="rounded px-1 py-0.5 text-[11px] text-ink-tertiary transition-colors hover:bg-state-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              {t('sidebar.viewAll')}
            </button>
          )}
        </div>

        {sidebarSection === 'knowledge' ? (
          filteredSpaces.length === 0 ? (
            <p className="px-2 py-4 text-center text-meta text-ink-tertiary" role="status">
              {q ? t('sidebar.emptySearch') : t('sidebar.emptySpaces')}
            </p>
          ) : (
            <ul className="m-0 list-none p-0" aria-labelledby="sidebar-list-heading">
              {filteredSpaces.map((sp) => {
                const active = activeView === 'knowledge' && activeSpaceId === sp.id
                return (
                  <li key={sp.id}>
                    <button
                      type="button"
                      data-testid={`sidebar-space-${sp.id}`}
                      data-no-drag
                      aria-current={active ? 'true' : undefined}
                      onClick={() => void openSpaceFromSidebar(sp.id)}
                      className={cn(
                        'mb-0.5 flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
                        active
                          ? 'bg-surface shadow-[0_0_0_1px_var(--border)]'
                          : 'hover:bg-state-hover',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-1.5 size-1.5 shrink-0 rounded-full',
                          active ? 'bg-accent' : 'bg-transparent',
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">
                        {sp.name}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )
        ) : filteredSessions.length === 0 ? (
          <p className="px-2 py-4 text-center text-meta text-ink-tertiary" role="status">
            {q ? t('sidebar.emptySearch') : t('sidebar.emptySessions')}
          </p>
        ) : (
          <ul className="m-0 list-none p-0" aria-labelledby="sidebar-list-heading">
            {filteredSessions.map((session) => {
              const surface = surfaceOf(session.config)
              const active =
                session.id === activeSessionId &&
                (activeView === 'chat' || activeView === 'code')
              const surfaceLabel =
                surface === 'code' ? t('sidebar.badge.code') : t('sidebar.badge.chat')
              return (
                <li key={session.id}>
                  <DeclarativeContextMenu
                    kind="sessionHistory"
                    payload={{
                      sessionId: session.id,
                      title: session.title,
                      surface,
                    }}
                    className="mb-0.5 block w-full"
                  >
                    <button
                      type="button"
                      data-testid={`sidebar-session-${session.id}`}
                      data-no-drag
                      aria-current={active ? 'true' : undefined}
                      aria-label={`${session.title}, ${surfaceLabel}`}
                      onClick={() => void selectSessionFromSidebar(session.id)}
                      className={cn(
                        'flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
                        active
                          ? 'bg-surface shadow-[0_0_0_1px_var(--border)]'
                          : 'hover:bg-state-hover',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-1.5 size-1.5 shrink-0 rounded-full',
                          active ? 'bg-accent' : 'bg-transparent',
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body font-medium text-ink" aria-hidden>
                          {session.title}
                        </span>
                        {session.preview ? (
                          <span
                            className="mt-0.5 block truncate text-[11px] text-ink-tertiary"
                            aria-hidden
                          >
                            {session.preview}
                          </span>
                        ) : null}
                      </span>
                      <span
                        className={cn(
                          'mt-0.5 shrink-0 rounded px-1 py-px text-[10px]',
                          surface === 'code'
                            ? 'bg-success/10 text-success'
                            : 'bg-surface-muted text-ink-tertiary',
                        )}
                        aria-hidden
                      >
                        {surfaceLabel}
                      </span>
                    </button>
                  </DeclarativeContextMenu>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <SidebarAccountFooter
        onOpenHistory={() => void openHistoryFromChrome()}
        onOpenSettings={() => void openSettingsFromChrome()}
        onLogout={() => {
          void (async () => {
            await leaveKnowledge()
            onLogout()
          })()
        }}
      />
    </aside>
  )
}

function NavItem({
  section,
  active,
  label,
  icon,
  count,
  onClick,
  onNew,
  newLabel,
}: {
  section: SidebarSection
  active: boolean
  label: string
  icon: ReactNode
  count?: number
  onClick: () => void
  onNew?: (e: MouseEvent) => void
  newLabel?: string
}) {
  // Row is a div so "+" is a sibling button (no nested interactive controls).
  return (
    <div
      className={cn(
        'group flex h-[34px] w-full items-center gap-0.5 rounded-lg pr-1 text-body font-medium',
        active ? 'bg-state-active text-ink' : 'text-ink-secondary',
      )}
    >
      <button
        type="button"
        data-testid={`sidebar-nav-${section}`}
        data-no-drag
        aria-current={active ? 'page' : undefined}
        onClick={onClick}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
          !active && 'hover:bg-state-hover hover:text-ink',
        )}
      >
        <span className={cn('shrink-0', active ? 'text-accent-strong' : 'opacity-85')}>{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count != null && !onNew ? (
          <span className="text-[11px] font-normal text-ink-tertiary" aria-label={String(count)}>
            {count}
          </span>
        ) : null}
      </button>
      {onNew ? (
        <button
          type="button"
          data-testid={`sidebar-new-${section}`}
          data-no-drag
          title={newLabel}
          aria-label={newLabel}
          onClick={onNew}
          className={cn(
            'inline-flex size-[22px] shrink-0 items-center justify-center rounded text-ink-tertiary transition-colors',
            'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
            active && 'opacity-100',
            'hover:bg-surface hover:text-ink',
            'focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
          )}
        >
          <Plus size={14} aria-hidden />
        </button>
      ) : null}
    </div>
  )
}
