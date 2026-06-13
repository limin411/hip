import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitBranch, Check, ChevronDown, Loader2 } from 'lucide-react'
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

      <Modal open={!!pending} onOpenChange={(o) => { if (!o && !switching) setPending(null) }} title={t('artifact.branch.switchConfirmTitle', { branch: pending ?? '' })}>
        <div className="flex flex-col gap-4 p-5">
          <p className="text-body text-ink-secondary">{t('artifact.branch.switchConfirmBody')}</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" disabled={switching} onClick={() => setPending(null)}>{t('common.cancel')}</Button>
            <Button
              size="sm"
              disabled={switching}
              data-testid="branch-switch-confirm"
              onClick={() => { if (pending) { setSwitching(true); sessionService.switchBranch(sessionId, pending) } }}
            >
              {switching && <Loader2 size={13} className={cn('mr-1.5 animate-spin')} />}
              {switching ? t('artifact.branch.switching') : t('artifact.branch.switchConfirmAction')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
