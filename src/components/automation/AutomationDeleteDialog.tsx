import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'

export type AutomationDeleteDialogProps = {
  open: boolean
  name: string
  onCancel: () => void
  onConfirm: () => void | Promise<void>
}

/**
 * Soft-delete confirm — moves automation to the product recycle bin.
 * Enter confirms; Escape / cancel dismisses (blocked while busy).
 */
export function AutomationDeleteDialog({
  open,
  name,
  onCancel,
  onConfirm,
}: AutomationDeleteDialogProps) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  const handleConfirm = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [onConfirm])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.isComposing || e.repeat) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      e.preventDefault()
      void handleConfirm()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, handleConfirm])

  if (!open) return null

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o && !busy) onCancel()
      }}
      title={t('automation.list.delete')}
      closeDisabled={busy}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            data-testid="automation-delete-cancel"
            onClick={onCancel}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={busy}
            autoFocus
            data-testid="automation-delete-confirm"
            onClick={() => void handleConfirm()}
          >
            {t('automation.list.delete')}
          </Button>
        </div>
      }
    >
      <p className="px-5 py-4 text-body leading-relaxed text-ink-secondary">
        {t('automation.list.deleteConfirmNamed', {
          name: name.trim() || t('automation.untitled'),
          defaultValue: t('automation.list.deleteConfirm'),
        })}
      </p>
    </Modal>
  )
}
