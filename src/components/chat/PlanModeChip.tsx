import { useTranslation } from 'react-i18next'
import { ListTree } from 'lucide-react'
import { ComposerChip } from './ComposerChip'
import { useDraftStore } from '@/store/draftStore'
import { useActiveSession, useActiveSessionId, sessionService } from '@/domain'

/**
 * Toggle force-plan for the active code session (or project draft before first send).
 * Orthogonal to permission mode — does not change chat/edit/full jail.
 */
export function PlanModeChip() {
  const { t } = useTranslation()
  const draftForce = useDraftStore((s) => s.draft?.forcePlan)
  const setDraftForce = useDraftStore((s) => s.setForcePlan)
  const activeId = useActiveSessionId()
  const session = useActiveSession()

  const current = activeId && session ? Boolean(session.config.forcePlan) : Boolean(draftForce)

  const toggle = () => {
    const next = !current
    if (activeId && session) sessionService.setForcePlan(activeId, next)
    else setDraftForce(next)
  }

  return (
    <ComposerChip
      type="button"
      active={current}
      title={t('chat.plan.chipTitle')}
      data-testid="plan-mode-chip"
      aria-pressed={current}
      onClick={toggle}
    >
      <ListTree size={13} className="shrink-0" aria-hidden />
      <span className="max-w-[100px] truncate">{t('chat.plan.chipLabel')}</span>
    </ComposerChip>
  )
}
