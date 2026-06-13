import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitBranch, Check, ChevronDown, Loader2, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDomainStore } from '@/domain/sessionStore'
import { sessionService } from '@/domain/sessionService'
import { useDiffStore, EMPTY_DIFF } from '@/store/diffStore'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel } from '@/components/ui/DropdownMenu'

/** Panel-header current-branch chip + branch dropdown + a switch-confirm modal. */
export function BranchSwitcher() {
  const { t } = useTranslation()
  const sessionId = useDomainStore((s) => s.activeSessionId)
  const diff = useDiffStore((s) => (sessionId ? s.bySession[sessionId] : undefined)) ?? EMPTY_DIFF
  const [pending, setPending] = useState<string | null>(null) // branch awaiting confirm
  const [switching, setSwitching] = useState(false)

  // Pull the branch list on mount / session change so the chip + dropdown are populated.
  useEffect(() => { if (sessionId) sessionService.requestBranches(sessionId) }, [sessionId])

  // Clear the switching spinner once the current branch reflects the pending target.
  useEffect(() => {
    if (switching && pending && diff.currentBranch === pending) { setSwitching(false); setPending(null) }
  }, [switching, pending, diff.currentBranch])

  // On a FAILED switch (e.g. dirty tree) the service records switchError → clear the spinner so the
  // modal is no longer stuck; the error stays visible until the user dismisses or retries.
  useEffect(() => { if (switching && diff.switchError) setSwitching(false) }, [switching, diff.switchError])

  // Reset all transient confirm state. ALWAYS reachable (Cancel / ESC / overlay / X) so a failed or
  // hung switch can never brick the modal.
  const closeConfirm = useCallback(() => {
    setPending(null)
    setSwitching(false)
    if (sessionId) useDiffStore.getState().setSwitchError(sessionId, null)
  }, [sessionId])

  if (!sessionId) return null
  const current = diff.currentBranch
  const branches = diff.branches

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            data-testid="branch-chip"
            className="flex items-center gap-1.5 rounded border border-border px-2 py-0.5 text-caption text-ink-secondary hover:bg-surface-muted"
            title={t('artifact.branch.current')}
          >
            <GitBranch size={12} className="shrink-0" />
            <span className="max-w-[120px] truncate">{current ?? t('artifact.branch.noBranch')}</span>
            <ChevronDown size={12} className="shrink-0 opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{t('artifact.branch.switchTitle')}</DropdownMenuLabel>
          {branches.map((b) => (
            <DropdownMenuItem
              key={b.name}
              data-testid="branch-option"
              onSelect={() => { if (!b.current) setPending(b.name) }}
              className="justify-between text-body"
            >
              <span className="truncate">{b.name}</span>
              {b.current && <Check size={14} className="shrink-0 text-accent" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Modal open={!!pending} onOpenChange={(o) => { if (!o) closeConfirm() }} title={t('artifact.branch.switchConfirmTitle', { branch: pending ?? '' })}>
        <div className="flex flex-col gap-4 p-5">
          <p className="text-body text-ink-secondary">{t('artifact.branch.switchConfirmBody')}</p>
          {diff.switchError && (
            <div data-testid="branch-switch-error" className="flex items-start gap-2 rounded border border-danger/40 bg-danger/10 p-2 text-meta text-ink">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-danger" />
              <span className="min-w-0 break-words">{t('artifact.branch.switchFailed')}{diff.switchError ? `: ${diff.switchError}` : ''}</span>
            </div>
          )}
          <div className="flex justify-end gap-2">
            {/* Cancel is ALWAYS enabled so a failed/hung switch can be backed out of. */}
            <Button variant="secondary" size="sm" onClick={closeConfirm}>{t('common.cancel')}</Button>
            <Button
              size="sm"
              disabled={switching}
              data-testid="branch-switch-confirm"
              onClick={() => { if (pending) { useDiffStore.getState().setSwitchError(sessionId, null); setSwitching(true); sessionService.switchBranch(sessionId, pending) } }}
            >
              {switching && <Loader2 size={13} className={cn('mr-1.5 animate-spin')} />}
              {switching ? t('artifact.branch.switching') : (diff.switchError ? t('artifact.branch.switchRetry') : t('artifact.branch.switchConfirmAction'))}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
