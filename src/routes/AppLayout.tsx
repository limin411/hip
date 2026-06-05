import { Sidebar } from '@/components/sidebar/Sidebar'
import { ChatHeader } from '@/components/chat/ChatHeader'
import { ChatPane } from '@/components/chat/ChatPane'
import { InputBar } from '@/components/chat/InputBar'
import { ArtifactPanel } from '@/components/artifact/ArtifactPanel'
import { useUiStore } from '@/store/uiStore'

export function AppLayout() {
  const panelOpen = useUiStore((s) => s.panelOpen)
  return (
    <div className="flex h-screen">
      <div className="w-60 border-r border-border">
        <Sidebar />
      </div>
      <div className="flex flex-1 flex-col bg-surface">
        <ChatHeader />
        <ChatPane />
        <InputBar />
      </div>
      {panelOpen && (
        <div className="w-[400px]">
          <ArtifactPanel />
        </div>
      )}
    </div>
  )
}
