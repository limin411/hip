import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { toast } from 'sonner'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { removeManagedWorktree } from '@/lib/worktreeRemove'
import type { WorktreeDeleteTarget } from './worktreeDeleteDialogStore'

export interface WorktreeDeleteDialogProps {
  target: WorktreeDeleteTarget
  onClose: () => void
}

/**
 * Confirm Modal for deleting an isolated workspace (D6 / D15).
 * - Always confirms before remove
 * - Cascade is informational only (no opt-out checkbox)
 * - Dirty: progressive force via interim string match (no file count)
 */
export function WorktreeDeleteDialog({ target, onClose }: WorktreeDeleteDialogProps) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [forceMode, setForceMode] = useState(false)

  // Reset progressive force when the target worktree changes.
  useEffect(() => {
    setForceMode(false)
    setBusy(false)
  }, [target.hostSessionId, target.worktreePath])

  const runRemove = async (force: boolean) => {
    if (busy) return
    setBusy(true)
    try {
      const r = await removeManagedWorktree({
        hostSessionId: target.hostSessionId,
        worktreePath: target.worktreePath,
        force,
        slotSessionId: target.slotSessionId,
        label: target.label,
        reason: target.reason ?? 'worktree-delete-dialog',
      })
      if (r.ok) {
        toast.success(
          force
            ? t('chat.worktreeControl.delete.removedForce', { label: target.label })
            : t('chat.worktreeControl.delete.removed', { label: target.label }),
        )
        onClose()
        return
      }
      if (!force && r.dirty) {
        setForceMode(true)
        return
      }
      toast.error(
        r.error || t('chat.worktreeControl.delete.failed', { label: target.label }),
      )
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message
          : t('chat.worktreeControl.delete.failed', { label: target.label }),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
      title={t('chat.worktreeControl.delete.title', { label: target.label })}
      className="max-w-md"
      footer={
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            data-testid="worktree-delete-cancel"
            onClick={onClose}
          >
            {t('common.cancel')}
          </Button>
          {forceMode ? (
            <Button
              type="button"
              variant="danger"
              size="sm"
              disabled={busy}
              aria-busy={busy}
              data-testid="worktree-delete-force"
              onClick={() => void runRemove(true)}
            >
              {busy
                ? t('chat.worktreeControl.delete.deleting')
                : t('chat.worktreeControl.delete.forceConfirm')}
            </Button>
          ) : (
            <Button
              type="button"
              variant="danger"
              size="sm"
              disabled={busy}
              aria-busy={busy}
              data-testid="worktree-delete-confirm"
              onClick={() => void runRemove(false)}
            >
              {busy
                ? t('chat.worktreeControl.delete.deleting')
                : t('chat.worktreeControl.delete.confirm')}
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-3 px-5 py-4" data-testid="worktree-delete-dialog">
        <DialogPrimitive.Description className="sr-only">
          {t('chat.worktreeControl.delete.title', { label: target.label })}
        </DialogPrimitive.Description>
        <dl className="space-y-1.5 text-meta text-ink-secondary">
          <div>
            <dt className="sr-only">{t('chat.worktreeControl.delete.pathLabel')}</dt>
            <dd className="break-all" data-testid="worktree-delete-path">
              {t('chat.worktreeControl.delete.path', { path: target.worktreePath })}
            </dd>
          </div>
          {target.branch ? (
            <div>
              <dt className="sr-only">{t('chat.worktreeControl.delete.branchLabel')}</dt>
              <dd data-testid="worktree-delete-branch">
                {t('chat.worktreeControl.delete.branch', { branch: target.branch })}
              </dd>
            </div>
          ) : null}
        </dl>

        <p
          className="text-meta text-ink-secondary"
          data-testid="worktree-delete-cascade"
        >
          {t('chat.worktreeControl.delete.cascadeNote')}
        </p>

        {forceMode ? (
          <p
            className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-meta text-ink"
            role="alert"
            data-testid="worktree-delete-dirty"
          >
            {t('chat.worktreeControl.delete.dirtyWarning')}
          </p>
        ) : null}
      </div>
    </Modal>
  )
}
