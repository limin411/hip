import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkItemStore } from '@/store/workItemStore'
import { useWorkItemViewStore } from '@/store/workItemViewStore'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import {
  closeWorkItemDeleteDialog,
  useWorkItemDeleteDialog,
} from './workItemDeleteDialogStore'

/**
 * Sibling soft-delete confirm (not nested in WorkItemEditorModal).
 * WorkItemEditorModal hides itself while this is open (no stacked overlays).
 * Confirm: soft-delete then close editor when it targets the same item.
 * Enter activates delete (same as the danger button); Escape dismisses via Modal.
 */
export function WorkItemDeleteConfirmHost() {
  const { t } = useTranslation()
  const dialog = useWorkItemDeleteDialog()
  const deleteItem = useWorkItemStore((s) => s.deleteItem)
  const [busy, setBusy] = useState(false)
  /** Sync lock — React `busy` alone can double-fire before re-render. */
  const busyRef = useRef(false)
  const dialogRef = useRef(dialog)
  dialogRef.current = dialog

  const handleConfirm = useCallback(async () => {
    const current = dialogRef.current
    if (!current || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await deleteItem(current.itemId)
      const modal = useWorkItemViewStore.getState().modal
      if (modal.mode === 'edit' && modal.itemId === current.itemId) {
        useWorkItemViewStore.getState().closeModal()
      }
      closeWorkItemDeleteDialog()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [deleteItem])

  // Enter = confirm delete while this dialog is open.
  useEffect(() => {
    if (!dialog) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.isComposing || e.repeat) return
      // Meta/Ctrl+Enter etc. are not "activate primary button".
      if (e.metaKey || e.ctrlKey || e.altKey) return
      e.preventDefault()
      void handleConfirm()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dialog, handleConfirm])

  if (!dialog) return null

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o && !busy) closeWorkItemDeleteDialog()
      }}
      title={t('workItems.actions.delete')}
      closeDisabled={busy}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => closeWorkItemDeleteDialog()}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            data-testid="work-item-delete-confirm"
            disabled={busy}
            autoFocus
            onClick={() => void handleConfirm()}
          >
            {t('workItems.actions.delete')}
          </Button>
        </div>
      }
    >
      <p className="px-5 py-4 text-body leading-relaxed text-ink-secondary">
        {t('workItems.deleteConfirm')}
      </p>
    </Modal>
  )
}
