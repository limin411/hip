import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

export interface RenameSessionDialogProps {
  title: string
  onConfirm: (nextTitle: string) => void
  onCancel: () => void
}

export function RenameSessionDialog({ title, onConfirm, onCancel }: RenameSessionDialogProps) {
  const { t } = useTranslation()
  const [value, setValue] = useState(title)
  const trimmed = value.trim()
  const canSave = trimmed.length > 0

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
      title={t('contextMenu.renameSession.title')}
      className="max-w-sm"
    >
      <div className="p-5">
        <DialogPrimitive.Description className="sr-only">
          {t('contextMenu.renameSession.description')}
        </DialogPrimitive.Description>
        <label className="flex flex-col gap-2">
          <span className="text-body text-ink-secondary">{t('contextMenu.renameSession.label')}</span>
          <Input
            autoFocus
            value={value}
            data-testid="rename-session-input"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canSave) {
                e.preventDefault()
                onConfirm(trimmed)
              }
            }}
          />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!canSave}
            data-testid="rename-session-confirm"
            onClick={() => {
              if (!canSave) return
              onConfirm(trimmed)
            }}
          >
            {t('contextMenu.renameSession.save')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
