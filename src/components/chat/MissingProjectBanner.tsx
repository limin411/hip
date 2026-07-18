import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { sessionService, useActiveSession } from '@/domain'
import { pickDirectory } from '@/ipc/dialog'
import { useProjectPathStore } from '@/store/projectPathStore'
import { Button } from '@/components/ui/Button'
import { projectPathKey } from '@/lib/sessionProjectGroups'

/**
 * Shown above the transcript when the active session's project folder is missing
 * (deleted on disk / inaccessible). Offers rebind or unbind — never deletes history.
 */
export function MissingProjectBanner() {
  const { t } = useTranslation()
  const session = useActiveSession()
  const cwd = session?.config.cwd
  const status = useProjectPathStore((s) => s.statusOf(cwd))

  if (!session || !cwd?.trim() || status !== 'missing') return null

  const pathLabel = projectPathKey(cwd) || cwd

  const rebind = async () => {
    const dir = await pickDirectory()
    if (!dir) return
    sessionService.setProjectDir(session.id, dir)
  }

  const unbind = () => {
    sessionService.clearProjectDir(session.id)
  }

  return (
    <div
      className="flex shrink-0 items-start gap-3 border-b border-warning/30 bg-warning/10 px-4 py-2.5"
      data-testid="missing-project-banner"
      role="status"
    >
      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-meta font-medium text-ink">{t('chat.missingProject.title')}</div>
        <div className="mt-0.5 truncate text-caption text-ink-secondary" title={pathLabel}>
          {t('chat.missingProject.desc', { path: pathLabel })}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button size="sm" data-testid="missing-project-rebind" onClick={() => void rebind()}>
          {t('chat.missingProject.rebind')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          data-testid="missing-project-unbind"
          onClick={unbind}
        >
          {t('chat.missingProject.unbind')}
        </Button>
      </div>
    </div>
  )
}
