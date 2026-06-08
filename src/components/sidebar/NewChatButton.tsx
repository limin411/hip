import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { sessionService } from '@/domain'

export function NewChatButton() {
  const { t } = useTranslation()
  return (
    <button
      onClick={() => sessionService.newConversation()}
      className="flex h-9 w-full items-center gap-2 rounded-md bg-accent px-3 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
      title={t('chat.newChat')}
    >
      <Plus size={18} />
      <span>{t('chat.newChat')}</span>
    </button>
  )
}
