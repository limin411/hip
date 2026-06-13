import { GitBranch, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useDomainStore } from '@/domain/sessionStore'
import { useDiffStore, EMPTY_DIFF } from '@/store/diffStore'
import { sessionService } from '@/domain/sessionService'
import { Button } from '@/components/ui/Button'

/** Thin banner shown in the 文件 tab when the cwd is not a git repo. Reuses fs:gitInit. */
export function GitInitBanner() {
  const { t } = useTranslation()
  const sessionId = useDomainStore((s) => s.activeSessionId)
  const diff = useDiffStore((s) => (sessionId ? s.bySession[sessionId] : undefined)) ?? EMPTY_DIFF
  if (!sessionId) return null
  return (
    <div className="flex items-center gap-3 border-b border-border bg-surface-muted/60 px-3 py-2">
      <GitBranch size={16} className="shrink-0 text-ink-tertiary" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-meta text-ink">{t('artifact.gitInitBanner.title')}</div>
        <div className="truncate text-caption text-ink-tertiary">{t('artifact.gitInitBanner.desc')}</div>
      </div>
      <Button size="sm" disabled={diff.initPending} onClick={() => sessionService.gitInitWorkspace(sessionId)}>
        {diff.initPending && <Loader2 size={13} className="mr-1.5 animate-spin" />}
        {t('artifact.gitInitBanner.button')}
      </Button>
    </div>
  )
}
