import { useTranslation } from 'react-i18next'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useHipConfigStore } from '@/store/hipConfigStore'
import { resolveTrashRetentionDays } from '@/lib/trashRetention'

export type ClearAllScope = 'all' | 'chat' | 'code' | 'search'

export interface ClearAllSessionsDialogProps {
  /** How many sessions will be moved to trash (current filter/search list). */
  count: number
  /** Which filter scope the list represents. */
  scope: ClearAllScope
  onConfirm: () => void
  onCancel: () => void
}

export function ClearAllSessionsDialog({
  count,
  scope,
  onConfirm,
  onCancel,
}: ClearAllSessionsDialogProps) {
  const { t } = useTranslation()
  const scopeLabel = t(`history.clearAllScope.${scope}`)
  const days = resolveTrashRetentionDays(useHipConfigStore((s) => s.config.trash?.retentionDays))
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
      title={t('history.clearAllConfirmTitle')}
      variant="confirm"
    >
      <div className="p-5">
        <DialogPrimitive.Description className="text-body text-ink-secondary">
          {t('history.clearAllConfirmBody', { count, scope: scopeLabel, days })}
        </DialogPrimitive.Description>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
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
