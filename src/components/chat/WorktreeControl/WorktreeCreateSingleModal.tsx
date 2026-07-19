import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { nanoid } from 'nanoid'
import { toast } from 'sonner'
import { sessionService } from '@/domain'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Switch } from '@/components/ui/Switch'
import { isNonGitWorktreeError } from '@/lib/worktreeCreateErrors'

export interface WorktreeCreateSingleModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Resolved host session for git:worktree:create (never an isolation id alone). */
  hostSessionId: string
  /** D24: parent sets non-git banner + disables further create. */
  onNonGitError?: () => void
}

/**
 * Single isolation create (PR4 / D5 / D9 / D12 / D23 / D24).
 * Auto branch hip-iso-{shortId}; no free-typed branch; no durable label.
 * Success toast is owned by serverMessageEffects when reveal:true — never toast success here.
 */
export function WorktreeCreateSingleModal({
  open,
  onOpenChange,
  hostSessionId,
  onNonGitError,
}: WorktreeCreateSingleModalProps) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  /** D9: default open new Code session. */
  const [openSession, setOpenSession] = useState(true)
  /** Preview only — regenerated on each open. */
  const [branch, setBranch] = useState('')

  useEffect(() => {
    if (!open) return
    // D12: auto-only hip-iso-{nanoid(6)}; safe charset from nanoid alphabet.
    setBranch(`hip-iso-${nanoid(6)}`)
    setOpenSession(true)
    setBusy(false)
  }, [open])

  const submit = async () => {
    if (busy || !hostSessionId || !branch) return
    setBusy(true)
    try {
      // D23: reveal true → effects toast only; do not toast.success here.
      const result = await sessionService.createManagedWorktree({
        hostSessionId,
        branch,
        createBranch: true,
        pathKey: branch,
        openSession,
        reveal: true,
      })
      if (!result.ok) {
        const err = result.error ?? t('chat.worktreeControl.createSingleFailed')
        if (isNonGitWorktreeError(err)) {
          onNonGitError?.()
          toast.error(t('chat.worktreeControl.nonGitBanner'))
        } else {
          toast.error(err || t('chat.worktreeControl.createSingleFailed'))
        }
        return
      }
      onOpenChange(false)
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).trim()
      if (isNonGitWorktreeError(msg)) {
        onNonGitError?.()
        toast.error(t('chat.worktreeControl.nonGitBanner'))
      } else {
        toast.error(msg || t('chat.worktreeControl.createSingleFailed'))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next)
      }}
      title={t('chat.worktreeControl.createSingleTitle')}
      footer={
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={busy || !hostSessionId || !branch}
            data-testid="worktree-create-single-confirm"
            aria-busy={busy}
            onClick={() => void submit()}
          >
            {busy
              ? t('chat.worktreeControl.createSingleCreating')
              : t('chat.worktreeControl.createSingleConfirm')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 px-5 py-4" data-testid="worktree-create-single-modal">
        <p className="text-meta text-ink-secondary">
          {t('chat.worktreeControl.createSingleHint')}
        </p>

        <div className="space-y-1.5">
          <div className="text-meta font-medium text-ink-secondary">
            {t('chat.worktreeControl.createSingleBranch')}
          </div>
          {/* Preview only — not an input (D12: no free-typed branch). */}
          <div
            className="rounded-md border border-border bg-surface-muted/50 px-3 py-2 font-mono text-meta text-ink"
            data-testid="worktree-create-single-branch"
            aria-readonly="true"
          >
            {branch || '…'}
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="text-meta font-medium text-ink-secondary">
            {t('chat.worktreeControl.createSingleBase')}
          </div>
          <div className="text-meta text-ink">
            {t('chat.worktreeControl.createSingleBaseHead')}
          </div>
        </div>

        <div className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <label
              htmlFor="worktree-create-open-session"
              className="text-meta font-medium text-ink"
            >
              {t('chat.worktreeControl.createSingleOpenSession')}
            </label>
            <p className="mt-0.5 text-[11px] leading-snug text-ink-tertiary">
              {t('chat.worktreeControl.createSingleOpenSessionHint')}
            </p>
          </div>
          <Switch
            id="worktree-create-open-session"
            checked={openSession}
            disabled={busy}
            onCheckedChange={setOpenSession}
            data-testid="worktree-create-single-open-session"
            ariaLabel={t('chat.worktreeControl.createSingleOpenSession')}
          />
        </div>
      </div>
    </Modal>
  )
}
