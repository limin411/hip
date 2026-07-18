import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { sessionService, useActiveSession } from '@/domain'
import { pickDirectory } from '@/ipc/dialog'
import { projectPathBlockReason } from '@/lib/projectPathGate'
import { projectPathKey } from '@/lib/sessionProjectGroups'
import { useProjectPathStore } from '@/store/projectPathStore'
import { Button } from '@/components/ui/Button'

/**
 * Code sessions must have a live project folder. Shown when unbound or when
 * the bound path is missing — send is blocked until the user rebinds.
 */
export function MissingProjectBanner() {
  const { t } = useTranslation()
  const session = useActiveSession()
  const cwd = session?.config.cwd
  const pathStatus = useProjectPathStore((s) => s.statusOf(cwd))
  const reason = session
    ? projectPathBlockReason(session.config, pathStatus)
    : 'none'

  if (!session || reason === 'none') return null

  const pathLabel = cwd?.trim() ? projectPathKey(cwd) || cwd : ''

  const rebind = async () => {
    const dir = await pickDirectory()
    if (!dir) return
    sessionService.setProjectDir(session.id, dir)
  }

  const title =
    reason === 'unbound'
      ? t('chat.missingProject.unboundTitle')
      : t('chat.missingProject.title')
  const desc =
    reason === 'unbound'
      ? t('chat.missingProject.unboundDesc')
      : t('chat.missingProject.desc', { path: pathLabel })

  return (
    <div
      className="flex shrink-0 items-start gap-3 border-b border-warning/30 bg-warning/10 px-4 py-2.5"
      data-testid="missing-project-banner"
      data-reason={reason}
      role="alert"
    >
      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="text-meta font-medium text-ink">{title}</div>
        <div
          className="mt-0.5 truncate text-caption text-ink-secondary"
          title={reason === 'missing' ? pathLabel : undefined}
        >
          {desc}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button size="sm" data-testid="missing-project-rebind" onClick={() => void rebind()}>
          {t('chat.missingProject.rebind')}
        </Button>
      </div>
    </div>
  )
}
