import { useTranslation } from 'react-i18next'
import { sessionService } from '@/domain'
import type { Surface } from '@/store/uiStore'
import { Button } from '@/components/ui/Button'

interface NewSessionButtonProps {
  surface: Surface
}

export function NewSessionButton({ surface }: NewSessionButtonProps) {
  const { t } = useTranslation()
  const label =
    surface === 'code' ? t('sidebar.newCodeTask')
    : t('sidebar.newChat')
  return (
    <Button
      variant="primary"
      size="sm"
      className="w-full"
      data-testid="new-session-button"
      onClick={() => sessionService.newConversation(surface)}
    >
      <span>{label}</span>
    </Button>
  )
}
