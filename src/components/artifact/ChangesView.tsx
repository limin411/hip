import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, GitBranch, GitCommit, Loader2 } from 'lucide-react'
import type { DiffFile } from '@hip/protocol'
import { useDomainStore } from '@/domain/sessionStore'
import { sessionService } from '@/domain/sessionService'
import { useDiffStore, EMPTY_DIFF } from '@/store/diffStore'
import { useFsStore } from '@/store/fsStore'
import { useUiStore } from '@/store/uiStore'
import { formatRelativeTime } from '@/lib/datetime'
import { resolvePathUnderCwd } from '@/lib/pathScope'
import { copyText } from '@/ipc/clipboard'
import { toast } from 'sonner'
import { DiffDisplay, Empty } from './DiffDisplay'
import { DeclarativeContextMenu } from '@/components/context-menu'
import { insertComposerText } from '@/components/command-palette/composerBridge'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
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
  const changesCommitExpanded = useUiStore((s) => s.changesCommitExpanded)
  const setChangesCommitExpanded = useUiStore((s) => s.setChangesCommitExpanded)
  const changesCommitHeight = useUiStore((s) => s.changesCommitHeight)
  const setChangesCommitHeight = useUiStore((s) => s.setChangesCommitHeight)
  const activeTab = useUiStore((s) => s.activeTab)
  const rootRef = useRef<HTMLDivElement>(null)
  const dragTeardownRef = useRef<(() => void) | null>(null)
  const [focusedPath, setFocusedPath] = useState<string | null>(null)
  const [discardPath, setDiscardPath] = useState<string | null>(null)
  const [narrow, setNarrow] = useState(false)
  const running = useDomainStore((s) => {
    if (!s.activeSessionId) return false
    return s.sessions.find((x) => x.id === s.activeSessionId)?.status === 'running'
  })

  // Refresh diff + commit log when the tab becomes active (Radix may keep the
  // component mounted while hidden) or when the session changes.
  useEffect(() => {
    if (!sessionId || activeTab !== 'changes') return
    sessionService.requestDiff(sessionId)
    sessionService.requestCommitLog(sessionId)
  }, [sessionId, activeTab])

  // Narrow right column (<420px): hide stats / file icons, keep the toolbar on one line.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const measure = () => setNarrow(el.getBoundingClientRect().width < 420)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Keep the keyboard-focused row visible.
  useEffect(() => {
    if (!focusedPath) return
    document.getElementById(`diff-file-${focusedPath}`)?.scrollIntoView({ block: 'nearest' })
  }, [focusedPath])

  const reviewFiles = (paths: string[]) => {
    const baseLabel =
      diff.base === 'session-start'
        ? t('artifact.diffView.baseSession')
        : t('artifact.diffView.baseHead')
    const prompt = t('artifact.changesView.reviewPrompt', {
      files: paths.join('\n'),
      base: baseLabel,
    })
    if (insertComposerText(prompt)) {
      toast.success(t('artifact.changesView.reviewInjected'))
    } else {
      toast.error(t('artifact.changesView.reviewNoComposer'))
    }
  }

  const confirmDiscard = (path: string, file: DiffFile) => {
    setDiscardPath(null)
    if (!sessionId) return
    sessionService.discardFile(sessionId, path, file.status, file.oldPath)
  }

  const openInFiles = (path: string) => {
    if (!sessionId) return
    const abs = resolvePathUnderCwd(cwd, path)
    if (!abs) return
    useUiStore.getState().setTab('files')
    useFsStore.getState().setActive(sessionId, abs)
    sessionService.readFile(sessionId, abs)
  }

  const copyPath = (path: string) => {
    void copyText(path)
  }

  // Minimal keyboard set while the panel is mounted (ignores form fields):
  // j/k move the file row, space toggles it, ⌘/Ctrl+Enter reviews, Esc returns
  // from a commit diff or closes discard popover.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        reviewFiles(diff.files.map((f) => f.path))
        return
      }
      if (e.key === 'Escape') {
        if (discardPath) {
          setDiscardPath(null)
          return
        }
        if (diff.viewingCommitSha && sessionId) {
          useDiffStore.getState().setViewingCommit(sessionId, null)
        }
        return
      }
      if (diff.viewingCommitSha) return
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault()
        const idx = diff.files.findIndex((f) => f.path === focusedPath)
        setFocusedPath(diff.files[Math.min(diff.files.length - 1, Math.max(0, idx + 1))]?.path ?? null)
        return
      }
      if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault()
        const idx = diff.files.findIndex((f) => f.path === focusedPath)
        setFocusedPath(diff.files[Math.max(0, idx - 1)]?.path ?? null)
        return
      }
      if (e.key === ' ' && focusedPath) {
        e.preventDefault()
        toggleFile(focusedPath, false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

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

  const hasUncommitted = diff.files.length > 0
  const log = diff.commitLog
  const hasCommits = log.commits.length > 0 || (log.state != null && log.state !== 'ok')
  const commitExpanded = hasUncommitted ? changesCommitExpanded : true
  const showCommitSection = hasUncommitted || hasCommits || log.status !== 'idle'

  const startCommitResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || dragTeardownRef.current) return
    e.preventDefault()
    e.stopPropagation()
    const root = rootRef.current
    if (!root) return
    setChangesCommitExpanded(true)
    const move = (ev: PointerEvent) => {
      const rect = root.getBoundingClientRect()
      setChangesCommitHeight(rect.bottom - ev.clientY)
    }
    const finish = () => {
      dragTeardownRef.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    const up = (ev: PointerEvent) => {
      if (ev.button !== 0) return
      finish()
    }
    const cancel = () => finish()

    dragTeardownRef.current = finish
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'row-resize'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
  }

  useEffect(() => () => dragTeardownRef.current?.(), [])

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

  if (diff.viewingCommitSha) {
    const sha = diff.viewingCommitSha
    return (
      <div className="flex h-full flex-col" data-testid="changes-view">
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/80 px-3">
          <button
            type="button"
            onClick={() => useDiffStore.getState().setViewingCommit(sessionId, null)}
            className="flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-caption text-ink-secondary transition-colors duration-chrome hover:bg-state-hover hover:text-ink"
            data-testid="changes-back-uncommitted"
          >
            ← {t('artifact.changesView.backToUncommitted')}
          </button>
          <span className="min-w-0 truncate font-mono text-caption text-ink-tertiary">{sha}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {diff.commitDiff.status === 'loading' ? (
            <div className="space-y-2 p-3" data-testid="changes-commit-diff-loading">
              <Skeleton className="h-8 w-full rounded-md" />
              <Skeleton className="h-8 w-full rounded-md" />
              <Skeleton className="h-8 w-3/4 rounded-md" />
            </div>
          ) : diff.commitDiff.state && diff.commitDiff.state !== 'ok' ? (
            <Empty title={t('artifact.changesView.commitDiffError')} desc={diff.commitDiff.error} />
          ) : diff.commitDiff.files.length === 0 ? (
            <Empty title={t('artifact.diffView.clean')} desc={t('artifact.diffView.cleanDesc')} />
          ) : (
            <DiffDisplay
              files={diff.commitDiff.files}
              viewMode={diffViewMode}
              sessionId={sessionId}
              cwd={cwd}
              showFileIcons={!narrow}
              onToggleCollapse={() => {}}
            />
          )}
        </div>
      </div>
    )
  }

  return (
    <div ref={rootRef} className="flex h-full flex-col" data-testid="changes-view">
      {/* Titlebar holds identity + baseline + Review + ⋯ (ChangesTitlebarActions). */}
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
              focusedPath={focusedPath}
              sessionId={sessionId}
              cwd={cwd}
              showFileIcons={!narrow}
              running={running}
              discardOpenPath={discardPath}
              discardPending={diff.discardPending}
              onDiscardOpen={setDiscardPath}
              onDiscardConfirm={confirmDiscard}
              onOpenInFiles={openInFiles}
              onReviewFile={(p) => reviewFiles([p])}
              onCopyPath={copyPath}
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
              className="relative z-10 h-2 shrink-0 cursor-row-resize touch-none bg-transparent transition-colors hover:bg-accent/40"
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
                  {t('artifact.changesView.recentCommits')}
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
                            className="px-3 py-0.5"
                          >
                            <button
                              type="button"
                              onClick={() => sessionService.requestCommitDiff(sessionId, c.sha)}
                              className="flex w-full items-center justify-between gap-2 py-2 text-meta transition-colors duration-chrome hover:bg-state-hover"
                              data-testid="commit-row-button"
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <span className="shrink-0 font-mono text-caption tabular-nums text-ink-tertiary">{c.shortSha}</span>
                                <span className="min-w-0 truncate text-ink">{c.message}</span>
                              </span>
                              <span className="shrink-0 text-caption text-ink-tertiary">{c.author} · {formatRelativeTime(c.timestamp, i18n.language)}</span>
                            </button>
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
