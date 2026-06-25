import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { sessionService } from '@/domain'
import { Button } from '@/components/ui/Button'

interface NewSessionButtonProps {
  surface: 'chat' | 'code'
}

export function NewSessionButton({ surface }: NewSessionButtonProps) {
  const { t } = useTranslation()
  return (
    <Button
      variant="outline"
      size="sm"
      className="w-full"
      onClick={() => sessionService.newConversation()}
    >
      <Plus size={16} />
      <span>{surface === 'code' ? t('sidebar.newCodeTask') : t('sidebar.newChat')}</span>
    </Button>
  )
}
