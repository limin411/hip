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
import { DiffViewer } from './DiffViewer'
import { useDomainStore } from '@/domain/sessionStore'
import { useDiffStore } from '@/store/diffStore'

export function ArtifactPanel() {
  const { t } = useTranslation()
  const TABS: { value: ArtifactTab; label: string }[] = [
    { value: 'files', label: t('artifact.files') },
    { value: 'agents', label: t('artifact.agents') },
    { value: 'diff', label: t('artifact.diff') },
  ]
  const activeTab = useUiStore((s) => s.activeTab)
  const setTab = useUiStore((s) => s.setTab)
  const togglePanel = useUiStore((s) => s.togglePanel)
  const sid = useDomainStore((s) => s.activeSessionId)
  const diffCount = useDiffStore((s) => (sid ? s.bySession[sid]?.summary?.totalFiles : 0)) ?? 0

  return (
    <div className="h-full animate-panel-in bg-surface">
      <Tabs value={activeTab} onValueChange={(v) => setTab(v as ArtifactTab)} className="flex h-full flex-col">
        <div
          data-tauri-drag-region
          className="flex h-11 shrink-0 items-center justify-between border-b border-border px-2"
        >
          <TabsList className="h-full gap-4" data-tauri-drag-region="false">
            {TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} data-testid={`tab-${tab.value}`}>
                {tab.label}
                {tab.value === 'diff' && diffCount > 0 && (
                  <span data-testid="diff-badge" className="ml-1.5 rounded-full bg-accent/15 px-1.5 text-caption text-accent">{diffCount}</span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
          <Button variant="ghost" size="icon" onClick={togglePanel} title={t('artifact.closePanel')} data-tauri-drag-region="false">
            <X size={16} />
          </Button>
        </div>

        <TabsContent value="files" className="overflow-hidden p-0">
          <PanelGroup direction="horizontal" className="h-full">
            <Panel defaultSize={42} minSize={24}>
              <FileTree />
            </Panel>
            <PanelResizeHandle className="group relative z-10 w-2 -mx-1 bg-transparent">
              <div className="mx-auto h-full w-px bg-border transition-colors group-hover:bg-accent group-data-[resize-handle-state=drag]:bg-accent" />
            </PanelResizeHandle>
            <Panel minSize={30}>
              <FilePreview />
            </Panel>
          </PanelGroup>
        </TabsContent>
        <TabsContent value="agents" className="p-3">
          <AgentDashboard />
        </TabsContent>
        <TabsContent value="diff" className="p-0">
          <DiffViewer />
        </TabsContent>
      </Tabs>
    </div>
  )
}
