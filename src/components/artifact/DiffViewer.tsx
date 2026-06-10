import { useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { GitBranch, Loader2, RefreshCw } from 'lucide-react'
import type { DiffFile, DiffLineType } from '@hip/protocol'
import { cn } from '@/lib/utils'
import { useDomainStore } from '@/domain/sessionStore'
import { sessionService } from '@/domain/sessionService'
import { useDiffStore, EMPTY_DIFF } from '@/store/diffStore'
import { Button } from '@/components/ui/Button'

function lineStyle(type: DiffLineType): string {
  if (type === 'add') return 'bg-success/10'
  if (type === 'del') return 'bg-danger/10'
  return ''
}

function sign(type: DiffLineType): string {
  if (type === 'add') return '+'
  if (type === 'del') return '-'
  return ' '
}

function FileDiff({ file }: { file: DiffFile }) {
  const { t } = useTranslation()
  return (
    <div className="border-b border-border" data-testid="diff-file">
      <div className="flex items-center justify-between bg-surface-muted px-3 py-2">
        <span className="truncate font-mono text-[12px] text-ink">{file.path}</span>
        <span className="flex shrink-0 items-center gap-2 text-[11px]">
          {file.truncated && <span className="text-ink-tertiary">{t('artifact.truncated')}</span>}
          <span className="text-success">+{file.additions}</span>
          <span className="text-danger">-{file.deletions}</span>
        </span>
      </div>
      {file.binary ? (
        <div className="px-3 py-2 text-[12px] text-ink-tertiary">{t('artifact.diffView.binary')}</div>
      ) : (
        <div className="overflow-x-auto font-mono text-[12.5px] leading-relaxed">
          {file.lines.map((line, i) => (
            <div key={i} className={cn('flex', lineStyle(line.type))}>
              <span className="w-10 shrink-0 select-none px-1 text-right text-ink-tertiary">{line.oldNo ?? ''}</span>
              <span className="w-10 shrink-0 select-none px-1 text-right text-ink-tertiary">{line.newNo ?? ''}</span>
              <span
                className={cn(
                  'w-4 shrink-0 select-none text-center',
                  line.type === 'add' && 'text-success',
                  line.type === 'del' && 'text-danger',
                )}
              >
                {sign(line.type)}
              </span>
              <span className="whitespace-pre px-1 text-ink">{line.content}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Empty({ icon, title, desc, children }: { icon?: ReactNode; title: string; desc?: string; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 py-12 text-ink-tertiary">
      <span className="text-[24px] opacity-40">{icon ?? '±'}</span>
      <div className="text-[13px]">{title}</div>
      {desc && <div className="max-w-[220px] text-center text-[12px] opacity-70">{desc}</div>}
      {children}
    </div>
  )
}

export function DiffViewer() {
  const { t } = useTranslation()
  const sessionId = useDomainStore((s) => s.activeSessionId)
  const diff = useDiffStore((s) => (sessionId ? s.bySession[sessionId] : undefined)) ?? EMPTY_DIFF

  // Radix unmounts inactive TabsContent, so mount === tab activation (and session switches re-run it).
  useEffect(() => {
    if (sessionId) sessionService.requestDiff(sessionId)
  }, [sessionId])

  if (!sessionId) {
    return <Empty title={t('artifact.diffView.noSession')} desc={t('artifact.diffView.noSessionDesc')} />
  }

  if (diff.status !== 'ready') {
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
        {diff.error && <div className="max-w-[220px] text-center text-[12px] text-danger">{diff.error}</div>}
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
        <span className="text-[12px] text-ink-secondary">{t('artifact.diffView.changedFiles', { count: diff.totalFiles })}</span>
        <button
          title={t('artifact.refresh')}
          data-testid="diff-refresh"
          onClick={() => sessionService.requestDiff(sessionId)}
          className="rounded p-1 text-ink-tertiary transition-colors hover:bg-surface-muted hover:text-ink"
        >
          <RefreshCw size={13} />
        </button>
      </div>
      {diff.files.length === 0 ? (
        <div data-testid="diff-clean" className="flex-1">
          <Empty title={t('artifact.diffView.clean')} desc={t('artifact.diffView.cleanDesc')} />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {diff.files.map((file) => (
            <FileDiff key={file.path} file={file} />
          ))}
          {diff.totalFiles > diff.files.length && (
            <div className="px-3 py-2 text-[12px] text-ink-tertiary">
              {t('artifact.diffView.moreFiles', { count: diff.totalFiles - diff.files.length })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
