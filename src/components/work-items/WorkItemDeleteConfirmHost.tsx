import { useState } from 'react'
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
 */
export function WorkItemDeleteConfirmHost() {
  const { t } = useTranslation()
  const dialog = useWorkItemDeleteDialog()
  const deleteItem = useWorkItemStore((s) => s.deleteItem)
  const [busy, setBusy] = useState(false)

  if (!dialog) return null

  const handleConfirm = async () => {
    if (busy) return
    setBusy(true)
    try {
      await deleteItem(dialog.itemId)
      const modal = useWorkItemViewStore.getState().modal
      if (modal.mode === 'edit' && modal.itemId === dialog.itemId) {
        useWorkItemViewStore.getState().closeModal()
      }
      closeWorkItemDeleteDialog()
    } finally {
      setBusy(false)
    }
  }

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
