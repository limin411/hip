import { useTranslation } from 'react-i18next'
import { useUiStore } from '@/store/uiStore'
import { useActiveMessages } from '@/domain'
import { collectConversationArtifacts } from '@/lib/renderedArtifacts'
import { FilePreview } from './FilePreview'
import { ConversationOutline } from './ConversationOutline'
import { SearchSourcesPanel } from './SearchSourcesPanel'
import { PanelToggle } from '@/components/layout/PanelToggle'
import { PanelTabBar } from './PanelTabBar'
import { PanelContextSlot } from './PanelContextSlot'

export function PreviewPanel() {
  const { t } = useTranslation()
  const messages = useActiveMessages()
  const artifacts = collectConversationArtifacts(messages)
  const chatActiveTab = useUiStore((s) => s.chatActiveTab)

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-border bg-surface">
      <div
        data-tauri-drag-region
        className="flex h-[var(--titlebar-height)] shrink-0 items-center gap-1 px-2"
      >
        <PanelContextSlot surface="chat" />
        <div className="flex shrink-0 items-center gap-0.5" data-tauri-drag-region="false">
          <PanelTabBar surface="chat" />
          <PanelToggle slot="panel" />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden" data-testid={`panel-view-${chatActiveTab}`}>
        {chatActiveTab === 'outline' && <ConversationOutline />}
        {chatActiveTab === 'sources' && <SearchSourcesPanel />}
        {chatActiveTab === 'files' && (
          artifacts.length === 0 ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-body text-ink-tertiary" data-testid="preview-no-artifacts">
              {t('artifact.noArtifacts')}
            </div>
          ) : (
            <div className="h-full min-h-0">
              <FilePreview />
            </div>
          )
        )}
      </div>
    </div>
  )
}
