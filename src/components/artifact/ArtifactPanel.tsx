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
import { ConversationOutline } from './ConversationOutline'
import { TimelineView } from './TimelineView'
import { ChangesView } from './ChangesView'
import { GitInitBanner } from './GitInitBanner'
import { BranchSwitcher } from './BranchSwitcher'
import { TerminalView } from './TerminalView'
import { CODE_TERMINAL } from './terminalFeature'
import { useDomainStore } from '@/domain/sessionStore'
import { useDiffStore } from '@/store/diffStore'
const GIT_GATED: ReadonlySet<ArtifactTab> = new Set(['timeline', 'changes'])

function tabLabel(
  tab: ArtifactTab,
  t: (
    key:
      | 'artifact.files'
      | 'artifact.agents'
      | 'artifact.outline'
      | 'artifact.timeline'
      | 'artifact.changes'
      | 'artifact.terminal',
  ) => string,
): string {
  if (tab === 'files') return t('artifact.files')
  if (tab === 'agents') return t('artifact.agents')
  if (tab === 'outline') return t('artifact.outline')
  if (tab === 'timeline') return t('artifact.timeline')
  if (tab === 'changes') return t('artifact.changes')
  return t('artifact.terminal')
}

function resolveEffectiveTab(activeTab: ArtifactTab, isGitRepo: boolean): ArtifactTab {
  if (GIT_GATED.has(activeTab) && !isGitRepo) return 'files'
  // Flag-off leftover: treat like gated tab fallback.
  if (activeTab === 'terminal' && !CODE_TERMINAL) return 'files'
  return activeTab
}

export function ArtifactPanel() {
  const { t } = useTranslation()
  const activeTab = useUiStore((s) => s.activeTab)
  const activeSessionId = useActiveSessionId()
  const setSessionCodePanelOpen = useDomainStore((s) => s.setSessionCodePanelOpen)
  const sid = useDomainStore((s) => s.activeSessionId)
  const isGitRepo = useDiffStore((s) => (sid ? s.bySession[sid]?.isGitRepo : false)) ?? false

  const effectiveTab = resolveEffectiveTab(activeTab, isGitRepo)

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface shadow-panel">
      <div data-tauri-drag-region className="flex h-10 shrink-0 items-center justify-between border-b border-border px-2">
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
        {effectiveTab === 'outline' && <ConversationOutline />}
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
        {effectiveTab === 'terminal' && CODE_TERMINAL && <TerminalView />}
      </div>
    </div>
  )
}
