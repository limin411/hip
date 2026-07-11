import { useTranslation } from 'react-i18next'
import type { AgentConfig } from '@hip/protocol'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'

export function DeleteAgentDialog({
  agent,
  onConfirm,
  onCancel,
}: {
  agent: AgentConfig
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onCancel()
      }}
      title={t('settings.agents.deleteConfirmTitle', { name: agent.name })}
      className="max-w-sm"
    >
      <div className="p-5">
        <p className="text-body text-ink-secondary">{t('settings.agents.deleteConfirmBody')}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('settings.agents.cancel')}
          </Button>
          <Button variant="danger" size="sm" onClick={onConfirm}>
            {t('settings.agents.delete')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
