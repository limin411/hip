import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { sessionService } from '@/domain'
import type { Surface } from '@/store/uiStore'
import { Button } from '@/components/ui/Button'

interface NewSessionButtonProps {
  surface: Surface
  iconOnly?: boolean
}

export function NewSessionButton({ surface, iconOnly = false }: NewSessionButtonProps) {
  const { t } = useTranslation()
  const label =
    surface === 'code' ? t('sidebar.newCodeTask')
    : t('sidebar.newChat')

  if (iconOnly) {
    return (
      <Button
        variant="outline"
        size="icon"
        className="h-9 w-9 shrink-0 rounded-lg"
        aria-label={label}
        data-testid="new-session-button"
        onClick={() => sessionService.newConversation(surface)}
      >
        <Plus size={15} />
      </Button>
    )
  }

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
