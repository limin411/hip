import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { useUiStore } from '@/store/uiStore'
import { Button } from '@/components/ui/Button'
import { DocOutline } from './DocOutline'

/**
 * Knowledge right-rail: document outline (TOC).
 * Same chrome as ArtifactPanel / PreviewPanel — hosted in AppLayout's resizable drawer.
 */
export function KnowledgeOutlinePanel() {
  const { t } = useTranslation()
  const draftBody = useKnowledgeStore((s) => s.draftBody)
  const docBody = useKnowledgeStore((s) => s.docBody)
  const activeDocId = useKnowledgeStore((s) => s.activeDocId)
  const requestOutlineJump = useKnowledgeStore((s) => s.requestOutlineJump)
  const setKnowledgePanelOpen = useUiStore((s) => s.setKnowledgePanelOpen)

  const content = draftBody || docBody

  return (
    <div
      className="flex h-full min-h-0 flex-col border-l border-border bg-surface"
      data-testid="knowledge-outline-panel"
    >
      <div
        data-tauri-drag-region
        className="flex h-10 shrink-0 items-center justify-between border-b border-border px-2"
      >
        <span
          className="truncate px-1 text-body font-medium text-ink"
          data-tauri-drag-region="false"
          data-testid="panel-title"
        >
          {t('knowledge.outline.title')}
        </span>
        <div className="flex items-center gap-2" data-tauri-drag-region="false">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setKnowledgePanelOpen(false)}
            title={t('artifact.closePanel')}
            data-testid="knowledge-outline-panel-close"
          >
            <X size={16} />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {!activeDocId ? (
          <div
            className="flex h-full items-center justify-center px-4 py-8 text-center"
            data-testid="knowledge-doc-outline-no-doc"
            role="status"
          >
            <p className="text-meta text-ink-tertiary">{t('knowledge.outline.noDoc')}</p>
          </div>
        ) : (
          <DocOutline content={content} onSelect={(item) => requestOutlineJump(item)} />
        )}
      </div>
    </div>
  )
}
