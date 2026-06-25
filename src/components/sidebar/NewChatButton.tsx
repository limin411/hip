import { useTranslation } from 'react-i18next'
import { sessionService } from '@/domain'
import { Button } from '@/components/ui/Button'

export function NewChatButton() {
  const { t } = useTranslation()
  return (
    <Button
      variant="primary"
      size="sm"
      className="w-full"
      onClick={() => sessionService.newConversation()}
      title={t('chat.newChat')}
    >
      <span>{t('chat.newChat')}</span>
    </Button>
  )
}
