import {
  BookOpen,
  CheckSquare,
  MessageSquarePlus,
  Terminal,
  Zap,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
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
import './home.css'

type Action = {
  id: string
  labelKey: string
  hintKey: string
  icon: typeof MessageSquarePlus
  primary?: boolean
  onClick: () => void
  testId: string
}

/** Icon action cards — denser than a row of ghost buttons. */
export function QuickStart() {
  const { t } = useTranslation()

  const actions: Action[] = [
    {
      id: 'new-chat',
      labelKey: 'workbench.shortcuts.newChat',
      hintKey: 'workbench.shortcuts.newChatHint',
      icon: MessageSquarePlus,
      primary: true,
      onClick: () => void enterSection('chats'),
      testId: 'workbench-shortcut-new-chat',
    },
    {
      id: 'knowledge',
      labelKey: 'workbench.shortcuts.openKnowledge',
      hintKey: 'workbench.shortcuts.openKnowledgeHint',
      icon: BookOpen,
      onClick: () => void enterKnowledge(),
      testId: 'workbench-shortcut-knowledge',
    },
  ]

  if (WORK_ITEM_TRACKING) {
    actions.push({
      id: 'tasks',
      labelKey: 'workbench.shortcuts.openTasks',
      hintKey: 'workbench.shortcuts.openTasksHint',
      icon: CheckSquare,
      onClick: () => void enterWorkItemsSection(),
      testId: 'workbench-shortcut-tasks',
    })
  }
  if (AUTOMATION_PAGE) {
    actions.push({
      id: 'automations',
      labelKey: 'workbench.shortcuts.openAutomations',
      hintKey: 'workbench.shortcuts.openAutomationsHint',
      icon: Zap,
      onClick: () => void enterAutomationsSection(),
      testId: 'workbench-shortcut-automations',
    })
  }
  if (TERMINAL_MANAGEMENT) {
    actions.push({
      id: 'terminals',
      labelKey: 'workbench.shortcuts.openTerminals',
      hintKey: 'workbench.shortcuts.openTerminalsHint',
      icon: Terminal,
      onClick: () => void enterTerminalsSection({ library: true }),
      testId: 'workbench-shortcut-terminals',
    })
  }

  return (
    <section
      className="wb-home-quick"
      aria-label={t('workbench.shortcuts.title')}
      data-testid="workbench-shortcuts"
    >
      <h2 className="wb-home-section-label">{t('workbench.shortcuts.title')}</h2>
      <div className="wb-quick-grid">
        {actions.map((a) => {
          const Icon = a.icon
          return (
            <button
              key={a.id}
              type="button"
              className={`wb-quick-card${a.primary ? ' wb-quick-card--primary' : ''}`}
              data-testid={a.testId}
              onClick={a.onClick}
            >
              <span className="wb-quick-card-icon" aria-hidden>
                <Icon size={18} strokeWidth={1.75} />
              </span>
              <span className="wb-quick-card-label">{t(a.labelKey)}</span>
              <span className="wb-quick-card-hint">{t(a.hintKey)}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
