import { useTranslation } from 'react-i18next'
import { sessionService, useActiveSession } from '@/domain'
import { pickDirectory } from '@/ipc/dialog'
import { projectPathBlockReason } from '@/lib/projectPathGate'
import { projectPathKey } from '@/lib/sessionProjectGroups'
import { useProjectPathStore } from '@/store/projectPathStore'
import { Button } from '@/components/ui/Button'
import { ActionBanner } from '@/components/ui/ActionBanner'

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
    <ActionBanner
      tone="warning"
      role="alert"
      data-testid="missing-project-banner"
      data-reason={reason}
      title={title}
      description={
        <span className="block truncate" title={reason === 'missing' ? pathLabel : undefined}>
          {desc}
        </span>
      }
      actions={
        <Button size="sm" data-testid="missing-project-rebind" onClick={() => void rebind()}>
          {t('chat.missingProject.rebind')}
        </Button>
      }
    />
  )
}
