import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import {
  resolveLegacyBoardReplaceConfirm,
  useLegacyBoardReplaceDialog,
} from './legacyBoardReplaceDialogStore'

/**
 * Design-system confirm for LKD-8 unsupported legacy board replace (PR-M).
 * Enter confirms; Escape / cancel / outside dismiss resolves false.
 */
export function LegacyBoardReplaceConfirmHost() {
  const { t } = useTranslation()
  const dialog = useLegacyBoardReplaceDialog()
  const dialogRef = useRef(dialog)
  dialogRef.current = dialog

  const handleCancel = useCallback(() => {
    if (!dialogRef.current) return
    resolveLegacyBoardReplaceConfirm(false)
  }, [])

  const handleConfirm = useCallback(() => {
    if (!dialogRef.current) return
    resolveLegacyBoardReplaceConfirm(true)
  }, [])

  useEffect(() => {
    if (!dialog) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.isComposing || e.repeat) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      e.preventDefault()
      handleConfirm()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dialog, handleConfirm])

  if (!dialog) return null

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) handleCancel()
      }}
      title={t('knowledge.board.legacyReplaceTitle')}
      className="max-w-sm"
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-testid="legacy-board-replace-cancel"
            onClick={handleCancel}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            autoFocus
            data-testid="legacy-board-replace-confirm"
            onClick={handleConfirm}
          >
            {t('knowledge.board.legacyReplaceAction')}
          </Button>
        </div>
      }
    >
      <p className="px-5 py-4 text-body leading-relaxed text-ink-secondary">
        {t('knowledge.board.legacyReplaceConfirm')}
      </p>
    </Modal>
  )
}
