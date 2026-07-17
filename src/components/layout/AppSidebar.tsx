import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, Code2, MessageSquare, Search } from 'lucide-react'
import { useActiveSessionId, useSessions } from '@/domain'
import { isMacPlatform } from '@/lib/platform'
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
  newConversationFromSidebar,
  openHistoryFromChrome,
  openKnowledgeHome,
  openSettingsFromChrome,
  openSpaceFromSidebar,
  selectSessionFromSidebar,
} from './sidebarActions'
import { SidebarAccountFooter } from './SidebarAccountFooter'

export function AppSidebar() {
  const { t } = useTranslation()
  const handlePointerDown = useWindowDrag()
  const [query, setQuery] = useState('')
  const sidebarSection = useUiStore((s) => s.sidebarSection)
  const activeView = useUiStore((s) => s.activeView)
  const sessions = useSessions()
  const activeSessionId = useActiveSessionId()
  const spaces = useKnowledgeStore((s) => s.spaces)
  const activeSpaceId = useKnowledgeStore((s) => s.activeSpaceId)
  const isMac = isMacPlatform()
  const mod = isMac ? '⌘' : 'Ctrl+'

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

  const projectCount = useMemo(
    () => sessions.filter((s) => surfaceOf(s.config) === 'code').length,
    [sessions],
  )
  const chatCount = useMemo(
    () => sessions.filter((s) => surfaceOf(s.config) === 'chat').length,
    [sessions],
  )

  const onNav = (section: SidebarSection) => {
    if (section === 'knowledge') void enterKnowledge()
    else void enterSection(section)
  }

  const listLabel =
    sidebarSection === 'knowledge'
      ? t('sidebar.list.spaces')
      : sidebarSection === 'projects'
        ? t('sidebar.list.projects')
        : t('sidebar.list.chats')

  return (
    <aside
      className="glass-surface flex h-full w-[260px] shrink-0 flex-col border-r border-glass"
      data-testid="app-sidebar"
      aria-label={t('sidebar.aria')}
    >
      {/* mac: traffic-light clearance. Win/Linux: slim drag strip (caption lives on MainToolbar). */}
      <div
        data-tauri-drag-region
        data-testid="sidebar-drag-region"
        onPointerDown={handlePointerDown}
        className={cn('flex shrink-0 items-center', isMac ? 'h-10' : 'h-3')}
      >
        {isMac ? (
          <div
            className="shrink-0"
            style={{ width: 'var(--titlebar-lights-inset, 90px)' }}
            aria-hidden
          />
        ) : null}
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
          section="chats"
          active={sidebarSection === 'chats'}
          label={t('sidebar.nav.chats')}
          icon={<MessageSquare size={16} />}
          count={chatCount > 0 ? chatCount : undefined}
          onClick={() => onNav('chats')}
        />
        <NavItem
          section="projects"
          active={sidebarSection === 'projects'}
          label={t('sidebar.nav.projects')}
          icon={<Code2 size={16} />}
          count={projectCount > 0 ? projectCount : undefined}
          onClick={() => onNav('projects')}
        />
        <NavItem
          section="knowledge"
          active={sidebarSection === 'knowledge'}
          label={t('sidebar.nav.knowledge')}
          icon={<BookOpen size={16} />}
          count={spaces.length > 0 ? spaces.length : undefined}
          onClick={() => onNav('knowledge')}
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
              onClick={() => void openKnowledgeHome()}
              className="rounded px-1 py-0.5 text-[11px] text-ink-tertiary transition-colors hover:bg-state-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              {t('sidebar.manageSpaces')}
            </button>
          ) : sidebarSection === 'projects' ? (
            <button
              type="button"
              data-testid="sidebar-new-task"
              data-no-drag
              onClick={() => void newConversationFromSidebar('code')}
              className="rounded px-1 py-0.5 text-[11px] text-ink-tertiary transition-colors hover:bg-state-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              {t('sidebar.newTask')}
            </button>
          ) : (
            <button
              type="button"
              data-testid="sidebar-new-chat-list"
              data-no-drag
              onClick={() => void newConversationFromSidebar('chat')}
              className="rounded px-1 py-0.5 text-[11px] text-ink-tertiary transition-colors hover:bg-state-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              {t('sidebar.newChat')}
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
        active={
          activeView === 'settings' ? 'settings' : activeView === 'history' ? 'history' : null
        }
        onOpenHistory={() => void openHistoryFromChrome()}
        onOpenSettings={() => void openSettingsFromChrome()}
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
}: {
  section: SidebarSection
  active: boolean
  label: string
  icon: ReactNode
  count?: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      data-testid={`sidebar-nav-${section}`}
      data-no-drag
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={cn(
        'flex h-[34px] w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-body font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
        active
          ? 'bg-state-active text-ink'
          : 'text-ink-secondary hover:bg-state-hover hover:text-ink',
      )}
    >
      <span className={cn('shrink-0', active ? 'text-accent-strong' : 'opacity-85')}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count != null ? (
        <span className="text-[11px] font-normal text-ink-tertiary" aria-label={String(count)}>
          {count}
        </span>
      ) : null}
    </button>
  )
}
