import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitBranch, Loader2 } from 'lucide-react'
import type { DiffFile } from '@hip/protocol'
import { useDomainStore } from '@/domain/sessionStore'
import { sessionService } from '@/domain/sessionService'
import { useDiffStore, EMPTY_DIFF } from '@/store/diffStore'
import { useFsStore } from '@/store/fsStore'
import { useUiStore } from '@/store/uiStore'
import { resolvePathUnderCwd } from '@/lib/pathScope'
import { copyText } from '@/ipc/clipboard'
import { toast } from 'sonner'
import { DiffDisplay, Empty } from './DiffDisplay'
import { insertComposerText } from '@/components/command-palette/composerBridge'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'

export function ChangesView() {
  const { t } = useTranslation()
  const sessionId = useDomainStore((s) => s.activeSessionId)
  const cwd = useDomainStore((s) => {
    if (!s.activeSessionId) return null
    return s.sessions.find((x) => x.id === s.activeSessionId)?.config.cwd ?? null
  })
  const diff = useDiffStore((s) => (sessionId ? s.bySession[sessionId] : undefined)) ?? EMPTY_DIFF
  const diffViewMode = useUiStore((s) => s.diffViewMode)
  const activeTab = useUiStore((s) => s.activeTab)
  const rootRef = useRef<HTMLDivElement>(null)
  const [focusedPath, setFocusedPath] = useState<string | null>(null)
  const [discardPath, setDiscardPath] = useState<string | null>(null)
  const [narrow, setNarrow] = useState(false)
  const running = useDomainStore((s) => {
    if (!s.activeSessionId) return false
    return s.sessions.find((x) => x.id === s.activeSessionId)?.status === 'running'
  })

  // Refresh diff when the tab becomes active (Radix may keep the component
  // mounted while hidden) or when the session changes.
  useEffect(() => {
    if (!sessionId || activeTab !== 'changes') return
    sessionService.requestDiff(sessionId)
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
  // j/k move the file row, space toggles it, ⌘/Ctrl+Enter reviews, Esc closes discard.
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
        if (discardPath) setDiscardPath(null)
        return
      }
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

  return (
    <div ref={rootRef} className="flex h-full flex-col" data-testid="changes-view">
      <div className="flex min-h-0 flex-1 flex-col">
        {diff.status !== 'ready' && !diff.state ? (
          <div className="space-y-2 p-3" data-testid="changes-diff-loading">
            <Skeleton className="h-8 w-full rounded-md" />
            <Skeleton className="h-8 w-full rounded-md" />
            <Skeleton className="h-8 w-3/4 rounded-md" />
          </div>
        ) : diff.files.length === 0 ? (
          <Empty title={t('artifact.diffView.clean')} desc={t('artifact.diffView.cleanDesc')} />
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
    </div>
  )
}
