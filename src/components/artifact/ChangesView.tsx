import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, GitBranch, GitCommit, Loader2, MoreHorizontal } from 'lucide-react'
import { useDomainStore } from '@/domain/sessionStore'
import { sessionService } from '@/domain/sessionService'
import { useDiffStore, EMPTY_DIFF } from '@/store/diffStore'
import { useUiStore } from '@/store/uiStore'
import { formatRelativeTime } from '@/lib/datetime'
import { DiffDisplay, Empty } from './DiffDisplay'
import { DeclarativeContextMenu } from '@/components/context-menu'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import { cn } from '@/lib/utils'

const COMMIT_SECTION_COLLAPSED = 36

export function ChangesView() {
  const { t, i18n } = useTranslation()
  const sessionId = useDomainStore((s) => s.activeSessionId)
  const cwd = useDomainStore((s) => {
    if (!s.activeSessionId) return null
    return s.sessions.find((x) => x.id === s.activeSessionId)?.config.cwd ?? null
  })
  const diff = useDiffStore((s) => (sessionId ? s.bySession[sessionId] : undefined)) ?? EMPTY_DIFF
  const diffViewMode = useUiStore((s) => s.diffViewMode)
  const setDiffViewMode = useUiStore((s) => s.setDiffViewMode)
  const changesCommitExpanded = useUiStore((s) => s.changesCommitExpanded)
  const setChangesCommitExpanded = useUiStore((s) => s.setChangesCommitExpanded)
  const changesCommitHeight = useUiStore((s) => s.changesCommitHeight)
  const setChangesCommitHeight = useUiStore((s) => s.setChangesCommitHeight)
  const activeTab = useUiStore((s) => s.activeTab)
  const rootRef = useRef<HTMLDivElement>(null)

  // Refresh diff + commit log when the tab becomes active (Radix may keep the
  // component mounted while hidden) or when the session changes.
  useEffect(() => {
    if (!sessionId || activeTab !== 'changes') return
    sessionService.requestDiff(sessionId)
    sessionService.requestCommitLog(sessionId)
  }, [sessionId, activeTab])

  // Accordion defaults: ≤3 files all open; otherwise only the first opens.
  // Store-level `collapsed` (user clicks) wins over the computed default.
  const defaultCollapsed = useMemo(() => {
    const m: Record<string, boolean> = {}
    diff.files.forEach((f, i) => {
      m[f.path] = diff.files.length > 3 && i > 0
    })
    return m
  }, [diff.files])
  const collapsed = useMemo(
    () => ({ ...defaultCollapsed, ...diff.collapsed }),
    [defaultCollapsed, diff.collapsed],
  )

  const toggleFile = (path: string, multi: boolean) => {
    if (!sessionId) return
    if (multi) {
      useDiffStore.getState().toggleCollapsed(sessionId, path)
      return
    }
    // Single-click accordion: the clicked row flips, every other row closes.
    const next: Record<string, boolean> = {}
    for (const f of diff.files) next[f.path] = f.path !== path || !collapsed[path]
    useDiffStore.getState().setCollapsed(sessionId, next)
  }

  const setAllCollapsed = (value: boolean) => {
    if (!sessionId) return
    const next: Record<string, boolean> = {}
    for (const f of diff.files) next[f.path] = value
    useDiffStore.getState().setCollapsed(sessionId, next)
  }

  const refresh = () => {
    if (!sessionId) return
    sessionService.requestDiff(sessionId)
    sessionService.requestCommitLog(sessionId)
  }

  const hasUncommitted = diff.files.length > 0
  const log = diff.commitLog
  const hasCommits = log.commits.length > 0 || (log.state != null && log.state !== 'ok')
  const commitExpanded = hasUncommitted ? changesCommitExpanded : true
  const showCommitSection = hasUncommitted || hasCommits || log.status !== 'idle'

  const startCommitResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const root = rootRef.current
    if (!root) return
    setChangesCommitExpanded(true)
    const move = (ev: PointerEvent) => {
      const rect = root.getBoundingClientRect()
      setChangesCommitHeight(rect.bottom - ev.clientY)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  if (!sessionId) return <Empty title={t('artifact.diffView.noSession')} desc={t('artifact.diffView.noSessionDesc')} />

  // Reuse the existing not-a-repo / git-missing / no-cwd states for the uncommitted half.
  if (diff.state === 'no_cwd') return <Empty title={t('artifact.diffView.noCwd')} desc={t('artifact.diffView.noCwdDesc')} />
  if (diff.state === 'git_missing') return <Empty title={t('artifact.diffView.gitMissing')} desc={t('artifact.diffView.gitMissingDesc')} />
  if (diff.state === 'not_a_repo') {
    return (
      <Empty icon={<GitBranch size={24} />} title={t('artifact.diffView.notRepo')} desc={t('artifact.diffView.notRepoDesc')}>
        <Button size="sm" disabled={diff.initPending} onClick={() => sessionService.gitInitWorkspace(sessionId)}>
          {diff.initPending && <Loader2 size={13} className="mr-1.5 animate-spin" />}
          {t('artifact.diffView.initButton')}
        </Button>
      </Empty>
    )
  }

  const totalAdd = diff.files.reduce((n, f) => n + f.additions, 0)
  const totalDel = diff.files.reduce((n, f) => n + f.deletions, 0)

  return (
    <div ref={rootRef} className="flex h-full flex-col" data-testid="changes-view">
      {/* Single toolbar row — no extra hairline under the label (avoids sandwiching the toggle). */}
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 px-3">
        <span className="flex min-w-0 items-center gap-1.5 text-caption font-medium text-ink-tertiary">
          <span className="truncate">{t('artifact.changesView.uncommitted')}</span>
          {hasUncommitted && (
            <span className="shrink-0 tabular-nums text-ink-secondary">
              {diff.files.length}
              <span className="text-success"> +{totalAdd}</span>
              <span className="text-danger"> −{totalDel}</span>
            </span>
          )}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('artifact.changesView.toolbarMenu')}
              data-testid="changes-toolbar-menu"
            >
              <MoreHorizontal size={15} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" data-testid="changes-toolbar-menu-content">
            <DropdownMenuRadioGroup
              value={diffViewMode}
              onValueChange={(v) => setDiffViewMode(v as 'unified' | 'split')}
            >
              <DropdownMenuRadioItem value="unified" data-testid="changes-menu-unified">
                {t('artifact.diffView.viewUnified')}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="split" data-testid="changes-menu-split">
                {t('artifact.diffView.viewSplit')}
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setAllCollapsed(true)} data-testid="changes-menu-collapse-all">
              {t('artifact.changesView.collapseAll')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setAllCollapsed(false)} data-testid="changes-menu-expand-all">
              {t('artifact.changesView.expandAll')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={refresh} data-testid="changes-menu-refresh">
              {t('artifact.changesView.refresh')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {/* uncommitted (top) */}
        <div className={cn('flex min-h-0 flex-col', hasUncommitted ? 'flex-1' : 'shrink-0')}>
          {diff.status !== 'ready' && !diff.state ? (
            <div className="space-y-2 p-3" data-testid="changes-diff-loading">
              <Skeleton className="h-8 w-full rounded-md" />
              <Skeleton className="h-8 w-full rounded-md" />
              <Skeleton className="h-8 w-3/4 rounded-md" />
            </div>
          ) : diff.files.length === 0 ? (
            <div className={cn(hasCommits && 'h-[120px]')}>
              <Empty title={t('artifact.diffView.clean')} desc={t('artifact.diffView.cleanDesc')} />
            </div>
          ) : (
            <DiffDisplay
              files={diff.files}
              summary={diff.summary}
              viewMode={diffViewMode}
              expanded={diff.expanded}
              collapsed={collapsed}
              sessionId={sessionId}
              cwd={cwd}
              onToggleCollapse={(p, multi) => toggleFile(p, multi)}
              onShowFull={(p) => sessionService.requestDiffFile(sessionId, p, 'full')}
              onCollapseFull={(p) => useDiffStore.getState().collapseFile(sessionId, p)}
            />
          )}
        </div>

        {showCommitSection && (
          <>
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label={t('artifact.changesView.resizeCommits')}
              title={t('artifact.changesView.resizeCommits')}
              onPointerDown={startCommitResize}
              className="h-1.5 shrink-0 cursor-row-resize touch-none bg-transparent transition-colors hover:bg-accent/40"
              data-testid="changes-commit-divider"
            />
            {/* commit log (bottom) */}
            <div
              className="flex shrink-0 flex-col border-t border-border/80"
              style={{ height: commitExpanded ? changesCommitHeight : COMMIT_SECTION_COLLAPSED }}
              data-testid="changes-commit-section"
            >
              <button
                type="button"
                onClick={() => {
                  if (hasUncommitted) setChangesCommitExpanded(!commitExpanded)
                }}
                className={cn(
                  'flex h-9 shrink-0 items-center gap-1.5 px-3 text-caption font-medium text-ink-tertiary transition-colors duration-chrome',
                  hasUncommitted ? 'hover:text-ink' : 'cursor-default',
                )}
                data-testid="changes-commit-title"
              >
                <span className="inline-flex size-4 shrink-0 items-center justify-center">
                  {commitExpanded ? <ChevronDown size={14} strokeWidth={1.75} /> : <ChevronRight size={14} strokeWidth={1.75} />}
                </span>
                <span className="truncate">
                  {diff.hasSessionStart ? t('artifact.changesView.sessionCommits') : t('artifact.changesView.recentCommits')}
                </span>
                <span className="shrink-0 tabular-nums">{log.commits.length}</span>
              </button>
              {commitExpanded && (
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {log.status === 'loading' ? (
                    <div className="space-y-2 p-3" data-testid="changes-log-loading">
                      <Skeleton className="h-7 w-full rounded-md" />
                      <Skeleton className="h-7 w-full rounded-md" />
                      <Skeleton className="h-7 w-2/3 rounded-md" />
                    </div>
                  ) : log.state && log.state !== 'ok' ? (
                    <Empty title={t('artifact.changesView.commitLogError')} desc={log.error} />
                  ) : log.commits.length === 0 ? (
                    <Empty icon={<GitCommit size={24} strokeWidth={1.5} />} title={t('artifact.changesView.noCommits')} />
                  ) : (
                    <ul>
                      {log.commits.map((c) => (
                        <li key={c.sha} data-testid="commit-row">
                          <DeclarativeContextMenu
                            kind="commit"
                            payload={{ sha: c.sha, shortSha: c.shortSha, message: c.message, sessionId }}
                            className="flex items-center justify-between gap-2 px-3 py-2 text-meta transition-colors duration-chrome hover:bg-state-hover"
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="shrink-0 font-mono text-caption tabular-nums text-ink-tertiary">{c.shortSha}</span>
                              <span className="min-w-0 truncate text-ink">{c.message}</span>
                            </span>
                            <span className="shrink-0 text-caption text-ink-tertiary">{c.author} · {formatRelativeTime(c.timestamp, i18n.language)}</span>
                          </DeclarativeContextMenu>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
