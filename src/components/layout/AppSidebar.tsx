import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Code2,
  Folder,
  GitBranch,
  MessageSquare,
  Search,
} from 'lucide-react'
import { sessionService, useActiveSessionId, useSessions, type SessionVM } from '@/domain'
import { isMacPlatform } from '@/lib/platform'
import { surfaceOf } from '@/lib/sessions'
import { groupSessionsByProjectPath, projectPathKey } from '@/lib/sessionProjectGroups'
import { cn } from '@/lib/utils'
import { useWindowDrag } from '@/lib/useWindowDrag'
import { useCommandPaletteStore } from '@/store/commandPaletteStore'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { useProjectPathStore } from '@/store/projectPathStore'
import {
  shortWorktreeLabel,
  slotsForHost,
  useParallelStore,
  type ParallelRun,
  type ParallelSlot,
} from '@/store/parallelStore'
import {
  catalogMinusParallelPaths,
  useWorktreeStore,
  type CatalogWorktree,
} from '@/store/worktreeStore'
import {
  collectNestedWorktreeSessionIds,
  extractParallelNestingHints,
  nestableCatalogPaths,
} from '@/lib/worktreeNesting'
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
  /** Session ids whose worktree subtree is collapsed (default = expanded when slots exist). */
  const [worktreeCollapsed, setWorktreeCollapsed] = useState<Record<string, boolean>>({})
  const sidebarSection = useUiStore((s) => s.sidebarSection)
  const activeView = useUiStore((s) => s.activeView)
  const sessions = useSessions()
  const activeSessionId = useActiveSessionId()
  const spaces = useKnowledgeStore((s) => s.spaces)
  const activeSpaceId = useKnowledgeStore((s) => s.activeSpaceId)
  const parallelRuns = useParallelStore((s) => s.runs)
  const catalogById = useWorktreeStore((s) => s.byId)
  const isMac = isMacPlatform()
  const mod = isMac ? '⌘' : 'Ctrl+'

  const q = query.trim().toLowerCase()

  const hydrateWorktrees = (sessionId: string) => {
    sessionService.requestWorktreeList(sessionId)
  }

  /** Nested worktree / parallel-slot sessions — never top-level first-class rows. */
  const nestedWorktreeSessionIds = useMemo(() => {
    const hints = extractParallelNestingHints(parallelRuns)
    // Exclude primary (main-repo) catalog paths — host cwd === primary path after list hydrate.
    const catalogPaths = nestableCatalogPaths(Object.values(catalogById))
    return collectNestedWorktreeSessionIds({
      sessions: sessions.map((s) => ({ id: s.id, title: s.title, config: { cwd: s.config.cwd } })),
      slotSessionIds: hints.slotSessionIds,
      worktreePaths: [...hints.worktreePaths, ...catalogPaths],
    })
  }, [parallelRuns, catalogById, sessions])

  const runsByHost = useMemo(() => {
    const map = new Map<string, ParallelRun[]>()
    for (const run of parallelRuns) {
      if (!run.hostSessionId || run.slots.length === 0) continue
      const list = map.get(run.hostSessionId) ?? []
      list.push(run)
      map.set(run.hostSessionId, list)
    }
    return map
  }, [parallelRuns])

  const filteredSessions = useMemo(() => {
    const surface = sidebarSection === 'projects' ? 'code' : 'chat'
    if (sidebarSection !== 'projects' && sidebarSection !== 'chats') return []
    let list = sessions
      .filter((s) => surfaceOf(s.config) === surface)
      // Worktree-bound / slot sessions only appear nested under the host expand tree.
      .filter((s) => !nestedWorktreeSessionIds.has(s.id))
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
    if (q) {
      list = list.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.preview.toLowerCase().includes(q) ||
          (s.config.cwd ?? '').toLowerCase().includes(q) ||
          // Match worktree branch when searching
          (runsByHost.get(s.id) ?? []).some((r) =>
            r.slots.some((sl) => sl.branch.toLowerCase().includes(q)),
          ),
      )
    }
    return list
  }, [sessions, sidebarSection, q, nestedWorktreeSessionIds, runsByHost])

  /** Project sessions only: group top-level rows by workspace path. */
  const projectSessionGroups = useMemo(() => {
    if (sidebarSection !== 'projects') return []
    return groupSessionsByProjectPath(filteredSessions)
  }, [sidebarSection, filteredSessions])

  const pathStatusByKey = useProjectPathStore((s) => s.byKey)

  // Probe project folder existence when viewing Projects (lazy + TTL-cached).
  useEffect(() => {
    if (sidebarSection !== 'projects') return
    useProjectPathStore.getState().ensureChecked(projectSessionGroups.map((g) => g.cwd ?? g.pathKey))
  }, [sidebarSection, projectSessionGroups])

  const filteredSpaces = useMemo(() => {
    if (sidebarSection !== 'knowledge') return []
    let list = [...spaces]
    if (q) list = list.filter((sp) => sp.name.toLowerCase().includes(q))
    return list
  }, [spaces, sidebarSection, q])

  const projectCount = useMemo(
    () =>
      sessions.filter(
        (s) => surfaceOf(s.config) === 'code' && !nestedWorktreeSessionIds.has(s.id),
      ).length,
    [sessions, nestedWorktreeSessionIds],
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

  const toggleWorktree = (sessionId: string) => {
    setWorktreeCollapsed((prev) => ({ ...prev, [sessionId]: !prev[sessionId] }))
  }

  const isWorktreeExpanded = (sessionId: string) => worktreeCollapsed[sessionId] !== true

  return (
    <aside
      className="glass-surface flex h-full w-[260px] shrink-0 flex-col border-r border-glass"
      data-testid="app-sidebar"
      aria-label={t('sidebar.aria')}
    >
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
              data-new-session="code"
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
              data-new-session="chat"
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
        ) : sidebarSection === 'projects' ? (
          <ul className="m-0 list-none p-0" aria-labelledby="sidebar-list-heading">
            {projectSessionGroups.map((group) => {
              const groupId = group.pathKey || '__unbound'
              const groupLabel = group.label || t('sidebar.projectGroup.unbound')
              const groupTitle = group.cwd || t('sidebar.projectGroup.unbound')
              const pathEntry = group.pathKey
                ? pathStatusByKey[projectPathKey(group.pathKey)]
                : undefined
              const pathMissing = !!group.pathKey && pathEntry?.exists === false
              const headerTitle = pathMissing
                ? t('sidebar.projectGroup.missingTitle', { path: groupTitle })
                : groupTitle
              return (
                <li
                  key={groupId}
                  className="mb-2"
                  data-testid={`sidebar-project-group-${groupId}`}
                  data-path-missing={pathMissing ? 'true' : undefined}
                >
                  <div
                    className="mb-0.5 flex items-center gap-1.5 px-2 py-1"
                    title={headerTitle}
                    data-testid={`sidebar-project-group-header-${groupId}`}
                  >
                    {pathMissing ? (
                      <AlertTriangle
                        size={12}
                        className="shrink-0 text-warning"
                        aria-hidden
                      />
                    ) : (
                      <Folder size={12} className="shrink-0 text-ink-tertiary" aria-hidden />
                    )}
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide',
                        pathMissing ? 'text-warning' : 'text-ink-tertiary',
                      )}
                    >
                      {groupLabel}
                    </span>
                    {pathMissing ? (
                      <span
                        className="shrink-0 rounded bg-warning/15 px-1 py-px text-[10px] font-medium text-warning"
                        data-testid={`sidebar-project-group-missing-${groupId}`}
                      >
                        {t('sidebar.projectGroup.missingBadge')}
                      </span>
                    ) : group.sessions.length > 1 ? (
                      <span className="shrink-0 tabular-nums text-[10px] text-ink-tertiary">
                        {group.sessions.length}
                      </span>
                    ) : null}
                  </div>
                  <ul className="m-0 list-none p-0" aria-label={groupTitle}>
                    {group.sessions.map((session) => (
                      <SidebarSessionRow
                        key={session.id}
                        session={session}
                        activeSessionId={activeSessionId}
                        activeView={activeView}
                        parallelRuns={parallelRuns}
                        runsByHost={runsByHost}
                        worktreeExpanded={isWorktreeExpanded(session.id)}
                        onToggleWorktree={() => {
                          const next = !isWorktreeExpanded(session.id)
                          toggleWorktree(session.id)
                          if (next) hydrateWorktrees(session.id)
                        }}
                      />
                    ))}
                  </ul>
                </li>
              )
            })}
          </ul>
        ) : (
          <ul className="m-0 list-none p-0" aria-labelledby="sidebar-list-heading">
            {filteredSessions.map((session) => (
              <SidebarSessionRow
                key={session.id}
                session={session}
                activeSessionId={activeSessionId}
                activeView={activeView}
                parallelRuns={parallelRuns}
                runsByHost={runsByHost}
                worktreeExpanded={isWorktreeExpanded(session.id)}
                onToggleWorktree={() => {
                  const next = !isWorktreeExpanded(session.id)
                  toggleWorktree(session.id)
                  if (next) hydrateWorktrees(session.id)
                }}
              />
            ))}
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

function SidebarSessionRow({
  session,
  activeSessionId,
  activeView,
  parallelRuns,
  runsByHost,
  worktreeExpanded,
  onToggleWorktree,
}: {
  session: SessionVM
  activeSessionId: string | null
  activeView: string
  parallelRuns: ParallelRun[]
  runsByHost: Map<string, ParallelRun[]>
  worktreeExpanded: boolean
  onToggleWorktree: () => void
}) {
  const { t } = useTranslation()
  const catalogById = useWorktreeStore((s) => s.byId)
  void catalogById // subscribe to catalog updates

  const surface = surfaceOf(session.config)
  const active =
    session.id === activeSessionId && (activeView === 'chat' || activeView === 'code')
  const surfaceLabel = surface === 'code' ? t('sidebar.badge.code') : t('sidebar.badge.chat')
  const hostRuns = runsByHost.get(session.id) ?? []
  const slots = slotsForHost(parallelRuns, session.id)
  const parallelPaths = new Set(slots.map((s) => s.worktreePath).filter(Boolean))
  const catalogRows = catalogMinusParallelPaths(
    useWorktreeStore.getState().catalogForHost(session.id),
    parallelPaths,
  ).filter((c) => !c.isPrimary)
  const hasWorktrees = slots.length > 0 || catalogRows.length > 0
  const expanded = hasWorktrees && worktreeExpanded

  return (
    <li data-testid={`sidebar-session-group-${session.id}`}>
      <DeclarativeContextMenu
        kind="sessionHistory"
        payload={{
          sessionId: session.id,
          title: session.title,
          surface,
        }}
        className="mb-0.5 block w-full"
      >
        <div
          className={cn(
            'flex w-full items-center gap-0.5 rounded-lg transition-colors',
            active ? 'bg-surface shadow-[0_0_0_1px_var(--border)]' : 'hover:bg-state-hover',
          )}
        >
          {hasWorktrees ? (
            <button
              type="button"
              data-testid={`sidebar-session-expand-${session.id}`}
              data-no-drag
              aria-expanded={expanded}
              aria-label={
                expanded
                  ? t('sidebar.parallel.collapseWorktrees')
                  : t('sidebar.parallel.expandWorktrees')
              }
              title={
                expanded
                  ? t('sidebar.parallel.collapseWorktrees')
                  : t('sidebar.parallel.expandWorktrees')
              }
              onClick={(e) => {
                e.stopPropagation()
                onToggleWorktree()
              }}
              className={cn(
                'ml-1 flex size-5 shrink-0 items-center justify-center rounded text-ink-tertiary',
                'hover:bg-state-hover hover:text-ink',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
              )}
            >
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : (
            <span className="ml-1 size-5 shrink-0" aria-hidden />
          )}
          <button
            type="button"
            data-testid={`sidebar-session-${session.id}`}
            // Legacy e2e gate selectors (title-bar tabs removed).
            data-session-tab="true"
            data-session-id={session.id}
            aria-selected={active ? 'true' : 'false'}
            data-no-drag
            aria-current={active ? 'true' : undefined}
            aria-label={`${session.title}, ${surfaceLabel}`}
            onClick={() => void selectSessionFromSidebar(session.id)}
            className={cn(
              'flex min-w-0 flex-1 items-center gap-2 py-2 pr-2.5 text-left',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring rounded-r-lg',
            )}
          >
            <span
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                active ? 'bg-accent' : 'bg-transparent',
              )}
              aria-hidden
            />
            <span className="flex min-w-0 flex-1 items-center gap-1">
              <span className="block min-w-0 truncate text-body font-medium text-ink" aria-hidden>
                {session.title}
              </span>
              {hasWorktrees ? (
                <span
                  className="shrink-0 rounded bg-accent/10 px-1 py-px text-[10px] font-medium text-accent"
                  title={t('sidebar.parallel.slotCount', {
                    count: slots.length + catalogRows.length,
                  })}
                  data-testid={`sidebar-session-wt-badge-${session.id}`}
                >
                  {slots.length + catalogRows.length}
                </span>
              ) : null}
            </span>
            <span
              className={cn(
                'shrink-0 rounded px-1 py-px text-[10px]',
                surface === 'code'
                  ? 'bg-success/10 text-success'
                  : 'bg-surface-muted text-ink-tertiary',
              )}
              aria-hidden
            >
              {surfaceLabel}
            </span>
          </button>
        </div>
      </DeclarativeContextMenu>

      {expanded ? (
        <ul
          className="relative m-0 mb-1 ml-3 list-none border-l border-border/80 py-0.5 pl-0"
          data-testid={`sidebar-session-worktrees-${session.id}`}
          aria-label={t('sidebar.parallel.worktreeTree', { title: session.title })}
        >
          {hostRuns.map((run) => (
            <li key={run.id} className="m-0 p-0">
              {hostRuns.length > 1 ? (
                <div className="flex items-center gap-1 px-2 py-0.5 pl-3 text-[10px] font-medium uppercase tracking-wide text-ink-tertiary">
                  <GitBranch size={10} aria-hidden />
                  <span className="truncate">
                    {t('sidebar.parallel.group', { id: run.id.slice(0, 6) })}
                  </span>
                </div>
              ) : null}
              <ul className="m-0 list-none p-0">
                {run.slots.map((slot) => (
                  <WorktreeSlotRow
                    key={slot.sessionId || slot.taskId || `${run.id}-${slot.index}`}
                    run={run}
                    slot={slot}
                    activeSessionId={activeSessionId}
                    activeView={activeView}
                  />
                ))}
              </ul>
            </li>
          ))}
          {catalogRows.length > 0 ? (
            <li className="m-0 p-0">
              {hostRuns.length > 0 ? (
                <div className="flex items-center gap-1 px-2 py-0.5 pl-3 text-[10px] font-medium uppercase tracking-wide text-ink-tertiary">
                  <GitBranch size={10} aria-hidden />
                  <span className="truncate">
                    {t('sidebar.parallel.catalogGroup', {
                      defaultValue: 'Worktrees',
                    })}
                  </span>
                </div>
              ) : null}
              <ul className="m-0 list-none p-0">
                {catalogRows.map((row) => (
                  <CatalogWorktreeRow key={row.id} row={row} hostSessionId={session.id} />
                ))}
              </ul>
            </li>
          ) : null}
        </ul>
      ) : null}
    </li>
  )
}

function CatalogWorktreeRow({
  row,
  hostSessionId,
}: {
  row: CatalogWorktree
  hostSessionId: string
}) {
  const pathLabel = shortWorktreeLabel(row.path, row.branch)
  const label = row.label || row.branch || pathLabel
  return (
    <li>
      <DeclarativeContextMenu
        kind="worktree"
        payload={{
          hostSessionId,
          worktreePath: row.path,
          label,
          worktreeId: row.id,
        }}
        className="mb-0.5 block w-full"
      >
        <button
          type="button"
          data-testid={`sidebar-catalog-wt-${row.id}`}
          data-no-drag
          onClick={() => void selectSessionFromSidebar(hostSessionId)}
          title={row.path}
          className={cn(
            'flex w-full items-start gap-2 rounded-lg py-1.5 pl-3 pr-2 text-left transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
            'hover:bg-state-hover',
          )}
        >
          <GitBranch size={12} className="mt-0.5 shrink-0 text-ink-tertiary" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-medium text-ink">{label}</span>
            <span className="mt-0.5 block truncate text-[10px] text-ink-tertiary" title={row.path}>
              {pathLabel}
              {row.source ? ` · ${row.source}` : ''}
            </span>
          </span>
        </button>
      </DeclarativeContextMenu>
    </li>
  )
}

function WorktreeSlotRow({
  run,
  slot,
  activeSessionId,
  activeView,
}: {
  run: ParallelRun
  slot: ParallelSlot
  activeSessionId: string | null
  activeView: string
}) {
  const { t } = useTranslation()
  const sessions = useSessions()
  const session = slot.sessionId ? sessions.find((s) => s.id === slot.sessionId) : undefined
  const active =
    !!slot.sessionId &&
    slot.sessionId === activeSessionId &&
    (activeView === 'chat' || activeView === 'code')
  const isWinner = !!slot.sessionId && run.selectedSessionId === slot.sessionId
  const key = slot.sessionId || slot.taskId || `${run.id}-${slot.index}`
  const isAgentSlot = run.source === 'agent' || (!!slot.taskId && !slot.sessionId)
  const pathLabel = shortWorktreeLabel(slot.worktreePath, slot.branch)
  const label = session?.title || slot.branch || `P${slot.index}`

  const rowButton = (
    <button
      type="button"
      data-testid={`sidebar-parallel-slot-${key}`}
      data-no-drag
      aria-current={active ? 'true' : undefined}
      onClick={() => {
        if (slot.sessionId) void selectSessionFromSidebar(slot.sessionId)
        else if (run.hostSessionId) void selectSessionFromSidebar(run.hostSessionId)
      }}
      onDoubleClick={() => {
        if (slot.sessionId) sessionService.selectParallelWinner(run.id, slot.sessionId)
      }}
      title={
        isAgentSlot ? t('sidebar.parallel.agentSlotHint') : t('sidebar.parallel.slotHint')
      }
      className={cn(
        'flex w-full items-start gap-2 rounded-lg py-1.5 pl-3 pr-2 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
        active ? 'bg-surface shadow-[0_0_0_1px_var(--border)]' : 'hover:bg-state-hover',
      )}
    >
      <GitBranch
        size={12}
        className={cn(
          'mt-0.5 shrink-0',
          slot.status === 'error' ? 'text-danger' : 'text-ink-tertiary',
        )}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium text-ink">{label}</span>
        <span className="mt-0.5 block truncate text-[10px] text-ink-tertiary" title={slot.worktreePath}>
          {pathLabel}
          {slot.taskId ? ` · ${slot.taskId}` : ''}
          {isWinner ? ` · ${t('sidebar.parallel.winner')}` : ''}
        </span>
      </span>
    </button>
  )

  // No path yet (still creating) — no remove menu.
  if (!slot.worktreePath || !run.hostSessionId) {
    return <li className="mb-0.5">{rowButton}</li>
  }

  return (
    <li>
      <DeclarativeContextMenu
        kind="worktree"
        payload={{
          hostSessionId: run.hostSessionId,
          worktreePath: slot.worktreePath,
          label,
          slotSessionId: slot.sessionId || undefined,
          worktreeId: slot.worktreeId,
        }}
        className="mb-0.5 block w-full"
      >
        {rowButton}
      </DeclarativeContextMenu>
    </li>
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
          ? 'bg-surface text-ink shadow-[0_0_0_1px_var(--border)]'
          : 'text-ink-secondary hover:bg-state-hover hover:text-ink',
      )}
    >
      <span className="shrink-0 opacity-80">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count != null ? (
        <span className="shrink-0 tabular-nums text-[11px] text-ink-tertiary">{count}</span>
      ) : null}
    </button>
  )
}
