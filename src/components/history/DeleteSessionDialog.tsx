import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'

export interface DeleteSessionDialogProps {
  title: string
  onConfirm: (opts?: { deleteDerivedMemories?: boolean }) => void
  onCancel: () => void
}

export function DeleteSessionDialog({ title, onConfirm, onCancel }: DeleteSessionDialogProps) {
  const { t } = useTranslation()
  const [deleteDerivedMemories, setDeleteDerivedMemories] = useState(false)

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
        <label className="mt-4 flex cursor-pointer items-start gap-2 text-body text-ink-secondary">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-border"
            checked={deleteDerivedMemories}
            data-testid="delete-derived-memories"
            onChange={(e) => setDeleteDerivedMemories(e.target.checked)}
          />
          <span>{t('history.deleteDerivedMemories')}</span>
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() =>
              onConfirm(deleteDerivedMemories ? { deleteDerivedMemories: true } : undefined)
            }
          >
            {t('history.delete')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
