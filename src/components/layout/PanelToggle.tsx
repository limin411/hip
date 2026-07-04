import { useTranslation } from 'react-i18next'
import { PanelRight } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'
import { Button } from '@/components/ui/Button'

export function PanelToggle() {
  const { t } = useTranslation()
  const activeView = useUiStore((s) => s.activeView)
  const togglePanel = useUiStore((s) => s.togglePanel)
  const toggleChatPanel = useUiStore((s) => s.toggleChatPanel)
  const onToggle = activeView === 'code' ? togglePanel : toggleChatPanel

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onToggle}
      title={t('chat.togglePanel')}
      data-tauri-drag-region="false"
      data-testid="toggle-panel"
    >
      <PanelRight size={17} />
    </Button>
  )
}
