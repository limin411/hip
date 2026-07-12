import { useTranslation } from 'react-i18next'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'

export interface ConfirmDeleteSessionsDialogProps {
  count: number
  onConfirm: () => void
  onCancel: () => void
}

/** Bulk multi-tab permanent delete confirm (Path A). Single-tab close has no dialog. */
export function ConfirmDeleteSessionsDialog({
  count,
  onConfirm,
  onCancel,
}: ConfirmDeleteSessionsDialogProps) {
  const { t } = useTranslation()

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
      title={t('contextMenu.confirmDeleteSessions.title', { count })}
      className="max-w-sm"
    >
      <div className="p-5">
        <DialogPrimitive.Description className="text-body text-ink-secondary">
          {t('contextMenu.confirmDeleteSessions.body', { count })}
        </DialogPrimitive.Description>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            size="sm"
            data-testid="confirm-delete-sessions"
            onClick={onConfirm}
          >
            {t('contextMenu.confirmDeleteSessions.action')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
