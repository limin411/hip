import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import type { ArtifactTab } from '@/store/uiStore'
import { useUiStore } from '@/store/uiStore'
import { FileTree } from './FileTree'
import { FilePreview } from './FilePreview'
import { ConversationOutline } from './ConversationOutline'
import { ChangesView } from './ChangesView'
import { GitInitBanner } from './GitInitBanner'
import { TerminalView } from './TerminalView'
import { CODE_TERMINAL } from './terminalFeature'
import { useDomainStore } from '@/domain/sessionStore'
import { useDiffStore } from '@/store/diffStore'
import { PanelToggle } from '@/components/layout/PanelToggle'
import { PanelTabBar } from './PanelTabBar'
import { PanelContextSlot } from './PanelContextSlot'
import { CodeTerminalProvider } from './codeTerminalController'

const GIT_GATED: ReadonlySet<ArtifactTab> = new Set(['changes'])

function resolveEffectiveTab(activeTab: ArtifactTab, isGitRepo: boolean): ArtifactTab {
  if (GIT_GATED.has(activeTab) && !isGitRepo) return 'files'
  // Flag-off leftover: treat like gated tab fallback.
  if (activeTab === 'terminal' && !CODE_TERMINAL) return 'files'
  return activeTab
}

export function ArtifactPanel() {
  const activeTab = useUiStore((s) => s.activeTab)
  const sid = useDomainStore((s) => s.activeSessionId)
  const isGitRepo = useDiffStore((s) => (sid ? s.bySession[sid]?.isGitRepo : false)) ?? false

  const effectiveTab = resolveEffectiveTab(activeTab, isGitRepo)

  return (
    <CodeTerminalProvider>
      <div className="flex h-full min-h-0 flex-col border-l border-border bg-surface">
        <div
          data-tauri-drag-region
          className="flex h-[var(--titlebar-height)] shrink-0 items-center gap-1 px-2"
        >
          <PanelContextSlot surface="code" />
          <div className="flex shrink-0 items-center gap-0.5" data-tauri-drag-region="false">
            <PanelTabBar surface="code" />
            <PanelToggle slot="panel" />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden" data-testid={`panel-view-${effectiveTab}`}>
          {effectiveTab === 'outline' && <ConversationOutline />}
          {effectiveTab === 'files' && (
            <div className="flex h-full flex-col">
              {!isGitRepo && <GitInitBanner />}
              <PanelGroup direction="horizontal" className="min-h-0 flex-1">
                <Panel minSize={30}><FilePreview /></Panel>
                <PanelResizeHandle className="group relative z-10 w-2 -mx-1 bg-transparent">
                  <div className="mx-auto h-full w-px bg-border transition-colors group-hover:bg-accent group-data-[resize-handle-state=drag]:bg-accent" />
                </PanelResizeHandle>
                <Panel defaultSize={42} minSize={24}><FileTree /></Panel>
              </PanelGroup>
            </div>
          )}
          {effectiveTab === 'changes' && isGitRepo && <ChangesView />}
          {effectiveTab === 'terminal' && CODE_TERMINAL && <TerminalView />}
        </div>
      </div>
    </CodeTerminalProvider>
  )
}
