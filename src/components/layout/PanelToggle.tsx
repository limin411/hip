import { useTranslation } from 'react-i18next'
import { PanelRight } from 'lucide-react'
import { useActiveSessionId } from '@/domain'
import { useUiStore } from '@/store/uiStore'
import { useDomainStore } from '@/domain/sessionStore'
import { Button } from '@/components/ui/Button'

export function PanelToggle() {
  const { t } = useTranslation()
  const activeSessionId = useActiveSessionId()
  const activeView = useUiStore((s) => s.activeView)
  const toggleSessionCodePanel = useDomainStore((s) => s.toggleSessionCodePanel)
  const toggleSessionChatPanel = useDomainStore((s) => s.toggleSessionChatPanel)

  const onToggle = () => {
    if (!activeSessionId) return
    if (activeView === 'code') toggleSessionCodePanel(activeSessionId)
    else if (activeView === 'chat') toggleSessionChatPanel(activeSessionId)
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onToggle}
      disabled={activeSessionId == null}
      title={t('chat.togglePanel')}
      data-tauri-drag-region="false"
      data-no-drag
      data-testid="toggle-panel"
    >
      <PanelRight size={17} />
    </Button>
  )
}
