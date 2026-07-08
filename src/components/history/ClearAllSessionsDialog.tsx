import { useTranslation } from 'react-i18next'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'

export interface ClearAllSessionsDialogProps {
  onConfirm: () => void
  onCancel: () => void
}

export function ClearAllSessionsDialog({ onConfirm, onCancel }: ClearAllSessionsDialogProps) {
  const { t } = useTranslation()
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
      title={t('history.clearAllConfirmTitle')}
      className="max-w-sm"
    >
      <div className="p-5">
        <DialogPrimitive.Description className="text-body text-ink-secondary">
          {t('history.clearAllConfirmBody')}
        </DialogPrimitive.Description>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" size="sm" onClick={onConfirm}>
            {t('history.clearAllConfirmAction')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
