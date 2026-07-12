import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { GitBranch, GitCommit, Loader2 } from 'lucide-react'
import { useDomainStore } from '@/domain/sessionStore'
import { sessionService } from '@/domain/sessionService'
import { useDiffStore, EMPTY_DIFF } from '@/store/diffStore'
import { useUiStore } from '@/store/uiStore'
import { formatRelativeTime } from '@/lib/datetime'
import { DiffDisplay, Empty } from './DiffDisplay'
import { DeclarativeContextMenu } from '@/components/context-menu'
import { Button } from '@/components/ui/Button'
import { SegmentedControl } from '@/components/ui/SegmentedControl'

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
  const activeTab = useUiStore((s) => s.activeTab)

  // Refresh diff + commit log when the tab becomes active (Radix may keep the
  // component mounted while hidden) or when the session changes.
  useEffect(() => {
    if (!sessionId || activeTab !== 'changes') return
    sessionService.requestDiff(sessionId)
    sessionService.requestCommitLog(sessionId)
  }, [sessionId, activeTab])

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

  const log = diff.commitLog
  return (
    <div className="flex h-full flex-col" data-testid="changes-view">
      {/* uncommitted (top) */}
      <div className="flex min-h-0 flex-[3] flex-col border-b border-border">
        <div className="flex h-8 shrink-0 items-center justify-between px-3 text-meta text-ink-secondary">
          <span>{t('artifact.changesView.uncommitted')}</span>
          <SegmentedControl
            data-testid="diff-view-toggle"
            aria-label={t('artifact.diffView.viewUnified')}
            size="sm"
            value={diffViewMode}
            onChange={setDiffViewMode}
            options={[
              { value: 'unified', label: t('artifact.diffView.viewUnified') },
              { value: 'split', label: t('artifact.diffView.viewSplit') },
            ]}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {diff.status !== 'ready' && !diff.state ? (
            <div className="flex h-full items-center justify-center text-ink-tertiary"><Loader2 size={16} className="animate-spin" /></div>
          ) : diff.files.length === 0 ? (
            <Empty title={t('artifact.diffView.clean')} desc={t('artifact.diffView.cleanDesc')} />
          ) : (
            <DiffDisplay
              files={diff.files}
              summary={diff.summary}
              viewMode={diffViewMode}
              expanded={diff.expanded}
              collapsed={diff.collapsed}
              sessionId={sessionId}
              cwd={cwd}
              onToggleCollapse={(p) => useDiffStore.getState().toggleCollapsed(sessionId, p)}
              onShowFull={(p) => sessionService.requestDiffFile(sessionId, p, 'full')}
              onCollapseFull={(p) => useDiffStore.getState().collapseFile(sessionId, p)}
            />
          )}
        </div>
      </div>
      {/* commit log (bottom) — read-only */}
      <div className="flex min-h-0 flex-[2] flex-col">
        <div className="flex h-8 shrink-0 items-center px-3 text-meta text-ink-secondary">{t('artifact.changesView.commitLog')}</div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {log.status === 'loading' ? (
            <div className="flex h-full items-center justify-center text-ink-tertiary"><Loader2 size={16} className="animate-spin" /></div>
          ) : log.state && log.state !== 'ok' ? (
            <Empty title={t('artifact.changesView.commitLogError')} desc={log.error} />
          ) : log.commits.length === 0 ? (
            <Empty icon={<GitCommit size={24} />} title={t('artifact.changesView.noCommits')} />
          ) : (
            <ul>
              {log.commits.map((c) => (
                <li key={c.sha} data-testid="commit-row">
                  <DeclarativeContextMenu
                    kind="commit"
                    payload={{ sha: c.sha, shortSha: c.shortSha, message: c.message, sessionId }}
                    className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5 text-meta"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 font-mono text-caption text-ink-tertiary">{c.shortSha}</span>
                      <span className="min-w-0 truncate text-ink">{c.message}</span>
                    </span>
                    <span className="shrink-0 text-caption text-ink-tertiary">{c.author} · {formatRelativeTime(c.timestamp, i18n.language)}</span>
                  </DeclarativeContextMenu>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
