import { useTranslation } from 'react-i18next'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'

export interface DeleteSessionDialogProps {
  title: string
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteSessionDialog({ title, onConfirm, onCancel }: DeleteSessionDialogProps) {
  const { t } = useTranslation()
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
      title={t('history.deleteSessionConfirmTitle', { title })}
      className="max-w-sm"
    >
      <div className="p-5">
        <DialogPrimitive.Description className="text-body text-ink-secondary">
          {t('history.deleteSessionConfirmBody')}
        </DialogPrimitive.Description>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" size="sm" onClick={onConfirm}>
            {t('history.delete')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
