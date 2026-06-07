import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ArtifactTab } from '@/store/uiStore'
import { useUiStore } from '@/store/uiStore'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs'
import { Button } from '@/components/ui/Button'
import { DocRenderer } from './DocRenderer'
import { FileTree } from './FileTree'
import { AgentDashboard } from './AgentDashboard'
import { DiffViewer } from './DiffViewer'

export function ArtifactPanel() {
  const { t } = useTranslation()
  const TABS: { value: ArtifactTab; label: string }[] = [
    { value: 'doc', label: t('artifact.doc') },
    { value: 'files', label: t('artifact.files') },
    { value: 'agents', label: t('artifact.agents') },
    { value: 'diff', label: t('artifact.diff') },
  ]
  const activeTab = useUiStore((s) => s.activeTab)
  const setTab = useUiStore((s) => s.setTab)
  const togglePanel = useUiStore((s) => s.togglePanel)

  return (
    <div className="h-full bg-surface">
      <Tabs
        value={activeTab}
        onValueChange={(v) => setTab(v as ArtifactTab)}
        className="flex h-full flex-col"
      >
        <div
          data-tauri-drag-region
          className="flex h-11 shrink-0 items-center justify-between border-b border-border px-2"
        >
          <TabsList className="h-full gap-4" data-tauri-drag-region="false">
            {TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="flex items-center gap-0.5">
            <Button variant="ghost" size="icon" onClick={togglePanel} title={t('artifact.closePanel')} data-tauri-drag-region="false">
              <X size={16} />
            </Button>
          </div>
        </div>

        <TabsContent value="doc" className="p-4">
          <DocRenderer />
        </TabsContent>
        <TabsContent value="files" className="p-2">
          <FileTree />
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
