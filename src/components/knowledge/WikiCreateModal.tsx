import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'

export interface WikiCreateModalProps {
  open: boolean
  title: string
  busy?: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

/** Confirm before creating a doc from a broken wiki link (K20). */
export function WikiCreateModal({
  open,
  title,
  busy,
  onOpenChange,
  onConfirm,
}: WikiCreateModalProps) {
  const { t } = useTranslation()

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('knowledge.wiki.createTitle')}
      className="max-w-sm"
      footer={
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            data-testid="knowledge-wiki-create-cancel"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {t('common.cancel')}
          </Button>
          <Button
            data-testid="knowledge-wiki-create-confirm"
            disabled={busy || !title.trim()}
            onClick={onConfirm}
          >
            {t('knowledge.wiki.createConfirm')}
          </Button>
        </div>
      }
    >
      <div className="space-y-2 px-5 py-4 text-body text-ink-secondary">
        <p data-testid="knowledge-wiki-create-body">
          {t('knowledge.wiki.createBody', { title: title.trim() || '…' })}
        </p>
      </div>
    </Modal>
  )
}
