import { useTranslation } from 'react-i18next'
import { ListTree } from 'lucide-react'
import { ComposerChip } from './ComposerChip'
import { useDraftStore } from '@/store/draftStore'
import { useActiveSession, useActiveSessionId, useActiveSessionStatus } from '@/domain'
import { runPlanOff, runPlanOn } from '@/domain/commands'
import { cn } from '@/lib/utils'

/**
 * Toggle force-plan for the active code session (or project draft before first send).
 * Orthogonal to permission mode — does not change chat/edit/full jail.
 * Uses the same planActions path as /plan and /plan-off so the user gets a toast.
 */
export function PlanModeChip() {
  const { t } = useTranslation()
  const draftForce = useDraftStore((s) => s.draft?.forcePlan)
  const activeId = useActiveSessionId()
  const session = useActiveSession()
  const status = useActiveSessionStatus()

  const current = activeId && session ? Boolean(session.config.forcePlan) : Boolean(draftForce)
  const busy = status === 'running'

  const toggle = () => {
    if (busy) return
    const sessionId = activeId && session ? activeId : null
    if (current) runPlanOff(sessionId)
    else runPlanOn(sessionId)
  }

  return (
    <ComposerChip
      type="button"
      active={current}
      title={busy ? t('chat.plan.busyTitle') : t('chat.plan.chipTitle')}
      data-testid="plan-mode-chip"
      aria-pressed={current}
      disabled={busy}
      onClick={toggle}
      className={cn(
        current && 'rounded-md bg-accent-subtle text-accent-strong',
      )}
    >
      <ListTree size={13} className="shrink-0" aria-hidden />
      <span className="max-w-[100px] truncate">{t('chat.plan.chipLabel')}</span>
    </ComposerChip>
  )
}
