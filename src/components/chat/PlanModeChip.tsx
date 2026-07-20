import { useTranslation } from 'react-i18next'
import { ListTree } from 'lucide-react'
import { toast } from 'sonner'
import { ComposerChip } from './ComposerChip'
import { useDraftStore } from '@/store/draftStore'
import { useActiveSession, useActiveSessionId, useActiveSessionStatus } from '@/domain'
import { runPlanOff, runPlanOn } from '@/domain/commands'

/**
 * Toggle force-plan for the active code session (or project draft before first send).
 * Orthogonal to permission mode — does not change chat/edit/full jail.
 * Uses the same planActions path as /plan and /plan-off so the user gets a toast.
 * KD-12: while a turn is running, chip stays visually disabled and click only toasts
 * (no ExitPending queue in v1).
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
    // KD-12: toast-only while running (aria-disabled keeps click so toast can fire).
    if (busy) {
      toast.message(t('chat.plan.busyTitle'))
      return
    }
    const sessionId = activeId && session ? activeId : null
    if (current) runPlanOff(sessionId)
    else runPlanOn(sessionId)
  }

  return (
    <ComposerChip
      type="button"
      active={current}
      title={busy ? t('chat.plan.busyTitle') : t('chat.plan.whenToUse')}
      data-testid="plan-mode-chip"
      aria-pressed={current}
      aria-disabled={busy || undefined}
      className={busy ? 'cursor-not-allowed opacity-50' : undefined}
      onClick={toggle}
    >
      <ListTree size={13} strokeWidth={1.75} className="shrink-0 opacity-80" aria-hidden />
      <span className="max-w-[100px] truncate">{t('chat.plan.chipLabel')}</span>
    </ComposerChip>
  )
}
