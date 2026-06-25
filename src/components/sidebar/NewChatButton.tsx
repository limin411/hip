import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
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
      <Plus size={16} />
      <span>{t('chat.newChat')}</span>
    </Button>
  )
}
