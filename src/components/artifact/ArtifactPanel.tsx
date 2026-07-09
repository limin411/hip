import { X } from 'lucide-react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { useTranslation } from 'react-i18next'
import type { ArtifactTab } from '@/store/uiStore'
import { useUiStore } from '@/store/uiStore'
import { useActiveSessionId } from '@/domain'
import { Button } from '@/components/ui/Button'
import { FileTree } from './FileTree'
import { FilePreview } from './FilePreview'
import { AgentDashboard } from './AgentDashboard'
import { TimelineView } from './TimelineView'
import { ChangesView } from './ChangesView'
import { GitInitBanner } from './GitInitBanner'
import { BranchSwitcher } from './BranchSwitcher'
import { useDomainStore } from '@/domain/sessionStore'
import { useDiffStore } from '@/store/diffStore'
import { DagEditor } from '@/components/workflow/DagEditor'
import { useWorkflowStore } from '@/store/workflowStore'

const GIT_GATED: ReadonlySet<ArtifactTab> = new Set(['timeline', 'changes'])

function tabLabel(tab: ArtifactTab, t: (key: string) => string): string {
  if (tab === 'dag') return 'DAG'
  return t(`artifact.${tab}`)
}

export function ArtifactPanel() {
  const { t } = useTranslation()
  const activeTab = useUiStore((s) => s.activeTab)
  const activeSessionId = useActiveSessionId()
  const setSessionCodePanelOpen = useDomainStore((s) => s.setSessionCodePanelOpen)
  const sid = useDomainStore((s) => s.activeSessionId)
  const isGitRepo = useDiffStore((s) => (sid ? s.bySession[sid]?.isGitRepo : false)) ?? false
  const activeWorkflow = useWorkflowStore((s) => s.activeWorkflow)
  const runState = useWorkflowStore((s) => s.runState)

  // If the active tab got gated out (cwd changed to a non-repo), fall back to 文件.
  const effectiveTab: ArtifactTab =
    GIT_GATED.has(activeTab) && !isGitRepo ? 'files' : activeTab

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div data-tauri-drag-region className="flex h-11 shrink-0 items-center justify-between border-b border-border px-2">
        <span
          className="truncate px-1 text-body font-medium text-ink"
          data-tauri-drag-region="false"
          data-testid="panel-title"
        >
          {tabLabel(effectiveTab, t)}
        </span>
        <div className="flex items-center gap-2" data-tauri-drag-region="false">
          {isGitRepo && <BranchSwitcher />}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => activeSessionId && setSessionCodePanelOpen(activeSessionId, false)}
            title={t('artifact.closePanel')}
          >
            <X size={16} />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden" data-testid={`panel-view-${effectiveTab}`}>
        {effectiveTab === 'files' && (
          <div className="flex h-full flex-col">
            {!isGitRepo && <GitInitBanner />}
            <PanelGroup direction="horizontal" className="min-h-0 flex-1">
              <Panel defaultSize={42} minSize={24}><FileTree /></Panel>
              <PanelResizeHandle className="group relative z-10 w-2 -mx-1 bg-transparent">
                <div className="mx-auto h-full w-px bg-border transition-colors group-hover:bg-accent group-data-[resize-handle-state=drag]:bg-accent" />
              </PanelResizeHandle>
              <Panel minSize={30}><FilePreview /></Panel>
            </PanelGroup>
          </div>
        )}
        {effectiveTab === 'agents' && (
          <div className="h-full overflow-auto p-3">
            <AgentDashboard />
          </div>
        )}
        {effectiveTab === 'timeline' && isGitRepo && <TimelineView />}
        {effectiveTab === 'changes' && isGitRepo && <ChangesView />}
        {effectiveTab === 'dag' && (
          activeWorkflow ? (
            <DagEditor workflow={activeWorkflow} runState={runState ?? undefined} />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-body text-ink-tertiary">
              No workflow active. Run a DAG workflow from the model picker to see the visual editor.
            </div>
          )
        )}
      </div>
    </div>
  )
}
