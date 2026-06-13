import { X } from 'lucide-react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { useTranslation } from 'react-i18next'
import type { ArtifactTab } from '@/store/uiStore'
import { useUiStore } from '@/store/uiStore'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs'
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

export function ArtifactPanel() {
  const { t } = useTranslation()
  const activeTab = useUiStore((s) => s.activeTab)
  const setTab = useUiStore((s) => s.setTab)
  const togglePanel = useUiStore((s) => s.togglePanel)
  const sid = useDomainStore((s) => s.activeSessionId)
  const isGitRepo = useDiffStore((s) => (sid ? s.bySession[sid]?.isGitRepo : false)) ?? false
  const diffCount = useDiffStore((s) => (sid ? s.bySession[sid]?.summary?.totalFiles : 0)) ?? 0

  // Git-gated tabs only appear in a git repo. The two always-on tabs are 文件 / 智能体.
  const TABS: { value: ArtifactTab; label: string; gated?: boolean; badge?: number }[] = [
    { value: 'files', label: t('artifact.files') },
    { value: 'agents', label: t('artifact.agents') },
    { value: 'timeline', label: t('artifact.timeline'), gated: true },
    { value: 'changes', label: t('artifact.changes'), gated: true, badge: diffCount },
  ]
  const visible = TABS.filter((tab) => !tab.gated || isGitRepo)
  // If the active tab got gated out (cwd changed to a non-repo), fall back to 文件.
  const effectiveTab = visible.some((tab) => tab.value === activeTab) ? activeTab : 'files'

  return (
    <div className="h-full animate-panel-in bg-surface">
      <Tabs value={effectiveTab} onValueChange={(v) => setTab(v as ArtifactTab)} className="flex h-full flex-col">
        <div data-tauri-drag-region className="flex h-11 shrink-0 items-center justify-between border-b border-border px-2">
          <TabsList className="h-full gap-4" data-tauri-drag-region="false">
            {visible.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} data-testid={`tab-${tab.value}`}>
                {tab.label}
                {tab.value === 'changes' && (tab.badge ?? 0) > 0 && (
                  <span data-testid="changes-badge" className="ml-1.5 rounded-full bg-accent/15 px-1.5 text-caption text-accent">{tab.badge}</span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="flex items-center gap-2" data-tauri-drag-region="false">
            {isGitRepo && <BranchSwitcher />}
            <Button variant="ghost" size="icon" onClick={togglePanel} title={t('artifact.closePanel')}>
              <X size={16} />
            </Button>
          </div>
        </div>

        <TabsContent value="files" className="overflow-hidden p-0">
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
        </TabsContent>
        <TabsContent value="agents" className="p-3"><AgentDashboard /></TabsContent>
        {isGitRepo && <TabsContent value="timeline" className="p-0"><TimelineView /></TabsContent>}
        {isGitRepo && <TabsContent value="changes" className="p-0"><ChangesView /></TabsContent>}
      </Tabs>
    </div>
  )
}
