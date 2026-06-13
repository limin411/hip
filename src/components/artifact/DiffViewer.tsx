import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { GitBranch, Loader2, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDomainStore } from '@/domain/sessionStore'
import { sessionService } from '@/domain/sessionService'
import { useDiffStore, EMPTY_DIFF } from '@/store/diffStore'
import { useUiStore } from '@/store/uiStore'
import { Button } from '@/components/ui/Button'
import { DiffDisplay, Empty } from './DiffDisplay'

export function DiffViewer() {
  const { t } = useTranslation()
  const sessionId = useDomainStore((s) => s.activeSessionId)
  const diff = useDiffStore((s) => (sessionId ? s.bySession[sessionId] : undefined)) ?? EMPTY_DIFF
  const diffViewMode = useUiStore((s) => s.diffViewMode)
  const setDiffViewMode = useUiStore((s) => s.setDiffViewMode)

  useEffect(() => { if (sessionId) sessionService.requestDiff(sessionId) }, [sessionId])
  useEffect(() => { if (sessionId && diff.status === 'idle') sessionService.requestDiff(sessionId) }, [sessionId, diff.status])

  if (!sessionId) return <Empty title={t('artifact.diffView.noSession')} desc={t('artifact.diffView.noSessionDesc')} />
  if (diff.status !== 'ready' && !diff.state) {
    return <div className="flex h-full items-center justify-center text-ink-tertiary"><Loader2 size={16} className="animate-spin" /></div>
  }
  if (diff.state === 'no_cwd') return <Empty title={t('artifact.diffView.noCwd')} desc={t('artifact.diffView.noCwdDesc')} />
  if (diff.state === 'git_missing') return <Empty title={t('artifact.diffView.gitMissing')} desc={t('artifact.diffView.gitMissingDesc')} />
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
        <Button size="sm" variant="secondary" onClick={() => sessionService.requestDiff(sessionId)}>{t('artifact.diffView.retry')}</Button>
      </Empty>
    )
  }

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
                <button key={b} disabled={disabled}
                  onClick={() => { if (diff.base !== b) { useDiffStore.getState().setBase(sessionId, b); sessionService.requestDiff(sessionId, b) } }}
                  className={cn('px-2 py-0.5', diff.base === b ? 'bg-accent/15 text-accent' : 'text-ink-tertiary hover:text-ink', disabled && 'cursor-not-allowed opacity-40')}>
                  {t(b === 'session-start' ? 'artifact.diffView.baseSession' : 'artifact.diffView.baseHead')}
                </button>
              )
            })}
          </div>
          <div className="inline-flex overflow-hidden rounded border border-border text-caption" data-testid="diff-view-toggle">
            {(['unified', 'split'] as const).map((m) => (
              <button key={m} onClick={() => setDiffViewMode(m)}
                className={cn('px-2 py-0.5', diffViewMode === m ? 'bg-accent/15 text-accent' : 'text-ink-tertiary hover:text-ink')}>
                {t(m === 'unified' ? 'artifact.diffView.viewUnified' : 'artifact.diffView.viewSplit')}
              </button>
            ))}
          </div>
          <button title={t('artifact.refresh')} data-testid="diff-refresh" onClick={() => sessionService.requestDiff(sessionId)}
            className="rounded p-1 text-ink-tertiary transition-colors hover:bg-surface-muted hover:text-ink">
            <RefreshCw size={13} className={cn(diff.status === 'loading' && 'animate-spin')} />
          </button>
        </div>
      </div>
      {diff.files.length === 0 ? (
        <div data-testid="diff-clean" className="flex-1"><Empty title={t('artifact.diffView.clean')} desc={t('artifact.diffView.cleanDesc')} /></div>
      ) : (
        <DiffDisplay
          files={diff.files}
          summary={diff.summary}
          viewMode={diffViewMode}
          expanded={diff.expanded}
          collapsed={diff.collapsed}
          onToggleCollapse={(p) => useDiffStore.getState().toggleCollapsed(sessionId, p)}
          onShowFull={(p) => sessionService.requestDiffFile(sessionId, p, 'full')}
          onCollapseFull={(p) => useDiffStore.getState().collapseFile(sessionId, p)}
        />
      )}
    </div>
  )
}
