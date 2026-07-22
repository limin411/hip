import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { useTranslation } from 'react-i18next'
import { AgentDashboard } from './AgentDashboard'
import { TasksPanel } from './TasksPanel'

/**
 * Single right-panel page: Agents (top half) + Runtime (bottom half).
 * Shared by code ArtifactPanel and chat PreviewPanel.
 */
export function AgentsRuntimeSplit() {
  const { t } = useTranslation()

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="agents-runtime-split">
      <PanelGroup direction="vertical" className="min-h-0 flex-1">
        <Panel defaultSize={50} minSize={20} className="min-h-0">
          <div className="flex h-full min-h-0 flex-col">
            <div
              className="flex h-7 shrink-0 items-center border-b border-border px-2.5 text-caption font-medium text-ink-tertiary"
              data-testid="agents-runtime-agents-label"
            >
              {t('artifact.agents')}
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <AgentDashboard />
            </div>
          </div>
        </Panel>
        <PanelResizeHandle className="group relative z-10 h-2 -my-1 bg-transparent">
          <div className="mx-2 h-px bg-border transition-colors group-hover:bg-accent group-data-[resize-handle-state=drag]:bg-accent" />
        </PanelResizeHandle>
        <Panel defaultSize={50} minSize={20} className="min-h-0">
          <div className="flex h-full min-h-0 flex-col">
            <div
              className="flex h-7 shrink-0 items-center border-b border-border px-2.5 text-caption font-medium text-ink-tertiary"
              data-testid="agents-runtime-runtime-label"
            >
              {t('artifact.runtime')}
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <TasksPanel />
            </div>
          </div>
        </Panel>
      </PanelGroup>
    </div>
  )
}
