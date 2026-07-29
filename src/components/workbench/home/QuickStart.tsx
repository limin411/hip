import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import {
  enterAutomationsSection,
  enterKnowledge,
  enterSection,
  enterTerminalsSection,
  enterWorkItemsSection,
} from '@/components/layout/sidebarActions'
import { AUTOMATION_PAGE } from '@/components/automation/feature'
import { TERMINAL_MANAGEMENT } from '@/components/terminals/feature'
import { WORK_ITEM_TRACKING } from '@/components/work-items/feature'
import '../home/home.css'

export function QuickStart() {
  const { t } = useTranslation()

  return (
    <section
      className="wb-home-quick"
      aria-label={t('workbench.shortcuts.title')}
      data-testid="workbench-shortcuts"
    >
      <h2 className="wb-home-section-label">{t('workbench.shortcuts.title')}</h2>
      <div className="wb-home-quick-row">
        <Button
          type="button"
          variant="outline"
          size="md"
          onClick={() => void enterSection('chats')}
        >
          {t('workbench.shortcuts.newChat')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="md"
          onClick={() => void enterKnowledge()}
        >
          {t('workbench.shortcuts.openKnowledge')}
        </Button>
        {WORK_ITEM_TRACKING && (
          <Button
            type="button"
            variant="ghost"
            size="md"
            onClick={() => void enterWorkItemsSection()}
          >
            {t('workbench.shortcuts.openTasks')}
          </Button>
        )}
        {AUTOMATION_PAGE && (
          <Button
            type="button"
            variant="ghost"
            size="md"
            onClick={() => void enterAutomationsSection()}
          >
            {t('workbench.shortcuts.openAutomations')}
          </Button>
        )}
        {TERMINAL_MANAGEMENT && (
          <Button
            type="button"
            variant="ghost"
            size="md"
            onClick={() => void enterTerminalsSection({ library: true })}
          >
            {t('workbench.shortcuts.openTerminals')}
          </Button>
        )}
      </div>
    </section>
  )
}
