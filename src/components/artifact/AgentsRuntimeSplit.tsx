import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { useTranslation } from 'react-i18next'
import type { Message } from '@hip/protocol'
import { useActiveMessages, useActiveSessionId, useActiveSessionStatus } from '@/domain'
import { groupAllAgents } from '@/lib/turnAgents'
import { isCouncilLiveAgents } from '@/lib/roundtableCouncil'
import { useTaskRuntimeStore } from '@/store/taskRuntimeStore'
import { AgentDashboard } from './AgentDashboard'
import { TasksPanel } from './TasksPanel'

/**
 * Single right-panel page: Agents (top) + Runtime (bottom, only when tasks exist).
 * Shared by code ArtifactPanel and chat PreviewPanel.
 *
 * Roundtable council: Agents fills the pane (Runtime is rarely relevant mid-meeting).
 * No runtime tasks: Agents fills the pane (empty Runtime empty-state is not shown).
 * Otherwise keeps the resizable Agents / Runtime split.
 */
export function AgentsRuntimeSplit() {
  const { t } = useTranslation()
  const messages: Message[] = useActiveMessages()
  const status = useActiveSessionStatus()
  const sessionId = useActiveSessionId()
  const taskCount = useTaskRuntimeStore((s) => {
    if (!sessionId) return 0
    return Object.keys(s.bySession[sessionId]?.tasks ?? {}).length
  })
  const turns = groupAllAgents(messages, status)
  const latest = turns.length > 0 ? turns[turns.length - 1]! : null
  const latestMsg =
    latest != null
      ? messages.find((m) => m.id === latest.messageId) ??
        [...messages].reverse().find((m) => m.role === 'assistant')
      : null
  const council =
    isCouncilLiveAgents(latest?.agents ?? [], latestMsg?.roundtable) ||
    latestMsg?.roundtable?.engine === 'council'

  const agentsOnly = (label: string, fullTestId?: string) => (
    <div className="flex h-full min-h-0 flex-col" data-testid="agents-runtime-split">
      <div
        className="flex h-7 shrink-0 items-center border-b border-border px-2.5 text-caption font-medium text-ink-tertiary"
        data-testid="agents-runtime-agents-label"
      >
        {label}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden" data-testid={fullTestId}>
        <AgentDashboard />
      </div>
    </div>
  )

  if (council) {
    return agentsOnly(t('chat.roundtable.councilLabel'), 'agents-runtime-council-full')
  }

  if (taskCount === 0) {
    return agentsOnly(t('artifact.agents'), 'agents-runtime-agents-full')
  }

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
          <div className="h-px w-full bg-border transition-colors group-hover:bg-accent group-data-[resize-handle-state=drag]:bg-accent" />
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
