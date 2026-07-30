import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useUiStore } from '@/store/uiStore'

export interface RenameSessionDialogProps {
  title: string
  onConfirm: (nextTitle: string) => void
  onCancel: () => void
  /** Override dialog chrome (default: session rename copy). */
  dialogTitle?: string
  description?: string
  label?: string
  saveLabel?: string
  inputTestId?: string
  confirmTestId?: string
}

export function RenameSessionDialog({
  title,
  onConfirm,
  onCancel,
  dialogTitle,
  description,
  label,
  saveLabel,
  inputTestId = 'rename-session-input',
  confirmTestId = 'rename-session-confirm',
}: RenameSessionDialogProps) {
  const { t } = useTranslation()
  // Small form over History shell: confirm role gets data-confirm-dialog (shell Esc gate)
  // + nested light scrim when a utility overlay is open.
  const nested = useUiStore((s) => s.overlay != null)
  const [value, setValue] = useState(title)
  const trimmed = value.trim()
  const canSave = trimmed.length > 0

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
      title={dialogTitle ?? t('contextMenu.renameSession.title')}
      variant="confirm"
      nested={nested}
    >
      <div className="p-5">
        <DialogPrimitive.Description className="sr-only">
          {description ?? t('contextMenu.renameSession.description')}
        </DialogPrimitive.Description>
        <label className="flex flex-col gap-2">
          <span className="text-body text-ink-secondary">
            {label ?? t('contextMenu.renameSession.label')}
          </span>
          <Input
            autoFocus
            value={value}
            data-testid={inputTestId}
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
            data-testid={confirmTestId}
            onClick={() => {
              if (!canSave) return
              onConfirm(trimmed)
            }}
          >
            {saveLabel ?? t('contextMenu.renameSession.save')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
