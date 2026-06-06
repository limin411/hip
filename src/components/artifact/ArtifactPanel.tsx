import { FileText, FolderTree, Network, GitCompare, Maximize2, Minimize2, X } from 'lucide-react'
import type { ArtifactTab } from '@/mock/types'
import { useUiStore } from '@/store/uiStore'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs'
import { Button } from '@/components/ui/Button'
import { DocRenderer } from './DocRenderer'
import { FileTree } from './FileTree'
import { AgentDashboard } from './AgentDashboard'
import { DiffViewer } from './DiffViewer'

const TABS: { value: ArtifactTab; label: string; icon: typeof FileText }[] = [
  { value: 'doc', label: '文档', icon: FileText },
  { value: 'files', label: '文件', icon: FolderTree },
  { value: 'agents', label: '智能体', icon: Network },
  { value: 'diff', label: 'Diff', icon: GitCompare },
]

export function ArtifactPanel() {
  const activeTab = useUiStore((s) => s.activeTab)
  const setTab = useUiStore((s) => s.setTab)
  const fullscreen = useUiStore((s) => s.panelFullscreen)
  const toggleFullscreen = useUiStore((s) => s.toggleFullscreen)
  const togglePanel = useUiStore((s) => s.togglePanel)

  const body = (
    <Tabs
      value={activeTab}
      onValueChange={(v) => setTab(v as ArtifactTab)}
      className="flex h-full flex-col"
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-2">
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              <t.icon size={14} />
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" onClick={toggleFullscreen} title={fullscreen ? '还原' : '全屏'}>
            {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </Button>
          <Button variant="ghost" size="icon" onClick={togglePanel} title="关闭面板">
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
  )

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/20 p-6">
        <div className="h-full w-full max-w-5xl overflow-hidden rounded-xl border border-border bg-surface shadow-float">
          {body}
        </div>
      </div>
    )
  }

  return <div className="h-full p-3">{body}</div>
}
