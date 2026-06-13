import { useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, GitBranch, Loader2, RefreshCw } from 'lucide-react'
import type { DiffFile, DiffHunk, DiffLine, DiffLineType, DiffFileStatus } from '@hip/protocol'
import { cn } from '@/lib/utils'
import { computeHunkWordDiffs } from '@/lib/wordDiff'
import { buildSplitRows } from '@/lib/diffSplit'
import { useDomainStore } from '@/domain/sessionStore'
import { sessionService } from '@/domain/sessionService'
import { useDiffStore, EMPTY_DIFF } from '@/store/diffStore'
import { useUiStore } from '@/store/uiStore'
import { Button } from '@/components/ui/Button'

const STATUS_CHIP = {
  added: { cls: 'bg-success/15 text-success', key: 'artifact.diffView.statusAdded' },
  modified: { cls: 'bg-warning/15 text-warning', key: 'artifact.diffView.statusModified' },
  deleted: { cls: 'bg-danger/15 text-danger', key: 'artifact.diffView.statusDeleted' },
  renamed: { cls: 'bg-accent/15 text-accent', key: 'artifact.diffView.statusRenamed' },
} as const satisfies Record<DiffFileStatus, { cls: string; key: string }>

function lineStyle(t: DiffLineType): string { return t === 'add' ? 'bg-success/10' : t === 'del' ? 'bg-danger/10' : '' }
function sign(t: DiffLineType): string { return t === 'add' ? '+' : t === 'del' ? '-' : ' ' }

function HunkLines({ hunk, viewMode }: { hunk: DiffHunk; viewMode: 'unified' | 'split' }) {
  const { t } = useTranslation()

  if (viewMode === 'split') {
    const splitRows = buildSplitRows(hunk.lines)
    return (
      <>
        <div className="flex bg-surface-muted/60 text-caption text-ink-tertiary">
          <span className="shrink-0 select-none px-2 font-mono">@@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@</span>
          {hunk.header && <span className="truncate px-1 opacity-70">{hunk.header}</span>}
        </div>
        {splitRows.map((row, i) => (
          <div key={i} className="flex">
            {/* Left column (del / ctx) */}
            <div className={cn('flex flex-1 min-w-0', row.left ? lineStyle(row.left.type) : 'bg-surface-muted/30')}>
              {row.left ? (
                <>
                  <span className="w-10 shrink-0 select-none px-1 text-right text-ink-tertiary">{row.left.oldNo ?? ''}</span>
                  <span className={cn('w-4 shrink-0 select-none text-center', row.left.type === 'del' && 'text-danger')}>{sign(row.left.type)}</span>
                  <span className="whitespace-pre px-1 text-ink">{row.left.content}</span>
                </>
              ) : (
                <span className="w-full" />
              )}
            </div>
            {/* Divider */}
            <div className="w-px shrink-0 bg-border" />
            {/* Right column (add / ctx) */}
            <div className={cn('flex flex-1 min-w-0', row.right ? lineStyle(row.right.type) : 'bg-surface-muted/30')}>
              {row.right ? (
                <>
                  <span className="w-10 shrink-0 select-none px-1 text-right text-ink-tertiary">{row.right.newNo ?? ''}</span>
                  <span className={cn('w-4 shrink-0 select-none text-center', row.right.type === 'add' && 'text-success')}>{sign(row.right.type)}</span>
                  <span className="whitespace-pre px-1 text-ink">{row.right.content}</span>
                </>
              ) : (
                <span className="w-full" />
              )}
            </div>
          </div>
        ))}
      </>
    )
  }

  // unified mode (with word-level highlights)
  const spans = computeHunkWordDiffs(hunk.lines)
  return (
    <>
      <div className="flex bg-surface-muted/60 text-caption text-ink-tertiary">
        <span className="shrink-0 select-none px-2 font-mono">@@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@</span>
        {hunk.header && <span className="truncate px-1 opacity-70">{hunk.header}</span>}
      </div>
      {hunk.lines.map((line: DiffLine, i) => (
        <div key={i} className={cn('flex', lineStyle(line.type))}>
          <span className="w-10 shrink-0 select-none px-1 text-right text-ink-tertiary">{line.oldNo ?? ''}</span>
          <span className="w-10 shrink-0 select-none px-1 text-right text-ink-tertiary">{line.newNo ?? ''}</span>
          <span className={cn('w-4 shrink-0 select-none text-center', line.type === 'add' && 'text-success', line.type === 'del' && 'text-danger')}>{sign(line.type)}</span>
          {spans[i]
            ? <span className="whitespace-pre px-1 text-ink">{spans[i]!.map((sp, k) => <span key={k} className={cn(sp.changed && (line.type === 'add' ? 'bg-success/30' : 'bg-danger/30'))}>{sp.text}</span>)}</span>
            : <span className="whitespace-pre px-1 text-ink">{line.content}</span>}
          {line.noNewline && <span className="select-none px-1 text-ink-tertiary" title={t('artifact.diffView.noNewline')}>&#8626;&#824;</span>}
        </div>
      ))}
    </>
  )
}

function FileDiff({ file, sessionId, expanded, collapsed, viewMode }: { file: DiffFile; sessionId: string; expanded?: DiffFile; collapsed?: boolean; viewMode: 'unified' | 'split' }) {
  const { t } = useTranslation()
  const chip = STATUS_CHIP[file.status]
  const shown = expanded ?? file
  const isExpanded = !!expanded
  const isCollapsed = !!collapsed
  return (
    <div id={`diff-file-${file.path}`} className="border-b border-border" data-testid="diff-file">
      <div className="sticky top-0 z-[1] flex items-center justify-between gap-2 bg-surface-muted px-3 py-2">
        <span className="flex min-w-0 items-center gap-2">
          <button
            aria-label={isCollapsed ? t('artifact.diffView.expand') : t('artifact.diffView.collapse')}
            onClick={() => useDiffStore.getState().toggleCollapsed(sessionId, file.path)}
            className="shrink-0 text-ink-tertiary hover:text-ink"
            data-testid="diff-file-collapse-toggle"
          >
            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
          <span className={cn('shrink-0 rounded px-1 font-medium', chip.cls)} data-testid="diff-status">
            <span className="text-caption">{t(chip.key)}</span>
          </span>
          <span className="truncate font-mono text-meta text-ink">
            {file.oldPath && <span className="text-ink-tertiary">{file.oldPath} → </span>}{file.path}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-caption">
          {file.truncated && <span className="text-ink-tertiary">{t('artifact.truncated')}</span>}
          <span className="text-success">+{file.additions}</span>
          <span className="text-danger">-{file.deletions}</span>
        </span>
      </div>
      {!isCollapsed && (shown.binary ? (
        <div className="px-3 py-2 text-meta text-ink-tertiary">{t('artifact.diffView.binary')}</div>
      ) : shown.hunks.length === 0 ? (
        <div className="px-3 py-2 text-meta text-ink-tertiary">{t('artifact.diffView.modeOnly')}</div>
      ) : (
        <>
          <div className="overflow-x-auto font-mono text-meta leading-relaxed">
            {shown.hunks.map((h, i) => <HunkLines key={i} hunk={h} viewMode={viewMode} />)}
          </div>
          <div className="flex justify-center gap-3 border-t border-border py-1 text-caption text-ink-tertiary">
            {!isExpanded
              ? <button data-testid="diff-show-full" onClick={() => sessionService.requestDiffFile(sessionId, file.path, 'full')}>{t('artifact.diffView.showFull')}</button>
              : <button data-testid="diff-collapse-full" onClick={() => useDiffStore.getState().collapseFile(sessionId, file.path)}>{t('artifact.diffView.collapseFull')}</button>}
          </div>
        </>
      ))}
    </div>
  )
}

function Empty({ icon, title, desc, children }: { icon?: ReactNode; title: string; desc?: string; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 py-12 text-ink-tertiary">
      <span className="text-stat opacity-40">{icon ?? '±'}</span>
      <div className="text-body">{title}</div>
      {desc && <div className="max-w-[220px] text-center text-meta opacity-70">{desc}</div>}
      {children}
    </div>
  )
}

export function DiffViewer() {
  const { t } = useTranslation()
  const sessionId = useDomainStore((s) => s.activeSessionId)
  const diff = useDiffStore((s) => (sessionId ? s.bySession[sessionId] : undefined)) ?? EMPTY_DIFF
  const diffViewMode = useUiStore((s) => s.diffViewMode)
  const setDiffViewMode = useUiStore((s) => s.setDiffViewMode)

  // Radix unmounts inactive TabsContent, so mount === tab activation (and session switches re-run it).
  useEffect(() => {
    if (sessionId) sessionService.requestDiff(sessionId)
  }, [sessionId])

  // A reconnect sweeps a lost in-flight request back to 'idle' (resetTransient) —
  // re-request so the pane recovers without the user toggling tabs.
  useEffect(() => {
    if (sessionId && diff.status === 'idle') sessionService.requestDiff(sessionId)
  }, [sessionId, diff.status])

  if (!sessionId) {
    return <Empty title={t('artifact.diffView.noSession')} desc={t('artifact.diffView.noSessionDesc')} />
  }

  if (diff.status !== 'ready' && !diff.state) {
    return (
      <div className="flex h-full items-center justify-center text-ink-tertiary">
        <Loader2 size={16} className="animate-spin" />
      </div>
    )
  }

  if (diff.state === 'no_cwd') {
    return <Empty title={t('artifact.diffView.noCwd')} desc={t('artifact.diffView.noCwdDesc')} />
  }

  if (diff.state === 'git_missing') {
    return <Empty title={t('artifact.diffView.gitMissing')} desc={t('artifact.diffView.gitMissingDesc')} />
  }

  if (diff.state === 'not_a_repo') {
    return (
      <Empty icon={<GitBranch size={24} />} title={t('artifact.diffView.notRepo')} desc={t('artifact.diffView.notRepoDesc')}>
        <Button size="sm" data-testid="diff-init" disabled={diff.initPending} onClick={() => sessionService.gitInitWorkspace(sessionId)}>
          {diff.initPending && <Loader2 size={13} className="mr-1.5 animate-spin" />}
          {t('artifact.diffView.initButton')}
        </Button>
        {diff.error && <div className="max-w-[220px] text-center text-meta text-danger">{diff.error}</div>}
      </Empty>
    )
  }

  if (diff.state === 'error') {
    return (
      <Empty title={t('artifact.diffView.error')} desc={diff.error}>
        <Button size="sm" variant="secondary" onClick={() => sessionService.requestDiff(sessionId)}>
          {t('artifact.diffView.retry')}
        </Button>
      </Empty>
    )
  }

  // state === 'ok'
  return (
    <div className="flex h-full flex-col" data-testid="diff-view">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-2">
        <div className="flex items-center gap-3 text-meta text-ink-secondary">
          <span>{t('artifact.diffView.changedFiles', { count: diff.summary?.totalFiles ?? diff.files.length })}</span>
          {diff.summary && (diff.summary.totalAdditions > 0 || diff.summary.totalDeletions > 0) && (
            <span className="font-mono text-caption"><span className="text-success">+{diff.summary.totalAdditions}</span> <span className="text-danger">-{diff.summary.totalDeletions}</span></span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex overflow-hidden rounded border border-border text-caption" data-testid="diff-base-toggle">
            {(['session-start', 'head'] as const).map((b) => {
              const disabled = b === 'session-start' && !diff.hasSessionStart
              return (
                <button
                  key={b}
                  disabled={disabled}
                  onClick={() => { if (diff.base !== b) { useDiffStore.getState().setBase(sessionId, b); sessionService.requestDiff(sessionId, b) } }}
                  className={cn('px-2 py-0.5', diff.base === b ? 'bg-accent/15 text-accent' : 'text-ink-tertiary hover:text-ink', disabled && 'cursor-not-allowed opacity-40')}
                >
                  {t(b === 'session-start' ? 'artifact.diffView.baseSession' : 'artifact.diffView.baseHead')}
                </button>
              )
            })}
          </div>
          <div className="inline-flex overflow-hidden rounded border border-border text-caption" data-testid="diff-view-toggle">
            {(['unified', 'split'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setDiffViewMode(m)}
                className={cn('px-2 py-0.5', diffViewMode === m ? 'bg-accent/15 text-accent' : 'text-ink-tertiary hover:text-ink')}
              >
                {t(m === 'unified' ? 'artifact.diffView.viewUnified' : 'artifact.diffView.viewSplit')}
              </button>
            ))}
          </div>
          <button
            title={t('artifact.refresh')}
            data-testid="diff-refresh"
            onClick={() => sessionService.requestDiff(sessionId)}
            className="rounded p-1 text-ink-tertiary transition-colors hover:bg-surface-muted hover:text-ink"
          >
            <RefreshCw size={13} className={cn(diff.status === 'loading' && 'animate-spin')} />
          </button>
        </div>
      </div>
      {diff.files.length === 0 ? (
        <div data-testid="diff-clean" className="flex-1">
          <Empty title={t('artifact.diffView.clean')} desc={t('artifact.diffView.cleanDesc')} />
        </div>
      ) : (
        <>
          {diff.files.length > 1 && (
            <div className="shrink-0 border-b border-border bg-surface" data-testid="diff-file-list">
              {diff.files.map((file) => (
                <button
                  key={file.path}
                  data-testid="diff-file-jump"
                  onClick={() => document.getElementById(`diff-file-${file.path}`)?.scrollIntoView({ block: 'start' })}
                  className="flex w-full items-center justify-between px-3 py-0.5 text-meta hover:bg-surface-muted"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={cn('shrink-0 rounded px-1 text-caption font-medium', STATUS_CHIP[file.status].cls)}>{t(STATUS_CHIP[file.status].key)}</span>
                    <span className="truncate font-mono text-ink-secondary">{file.path}</span>
                  </span>
                  <span className="shrink-0 font-mono text-caption"><span className="text-success">+{file.additions}</span> <span className="text-danger">-{file.deletions}</span></span>
                </button>
              ))}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {diff.files.map((file, i) => (
              <FileDiff key={`${file.path}-${i}`} file={file} sessionId={sessionId} expanded={diff.expanded[file.path]} collapsed={diff.collapsed[file.path]} viewMode={diffViewMode} />
            ))}
            {(diff.summary?.totalFiles ?? 0) > diff.files.length && (
              <div className="px-3 py-2 text-meta text-ink-tertiary">
                {t('artifact.diffView.moreFiles', { count: (diff.summary!.totalFiles) - diff.files.length })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
