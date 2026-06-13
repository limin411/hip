import { useTranslation } from 'react-i18next'
import { FileText, FileImage, FileCode, FileType } from 'lucide-react'
import type { ToolCall } from '@hip/protocol'
import { sessionService } from '@/domain'
import { useFsScope } from '@/store/useFsScope'
import { useFsStore } from '@/store/fsStore'
import { useUiStore } from '@/store/uiStore'
import { extractRenderedArtifacts, type RenderedArtifact } from '@/lib/renderedArtifacts'
import { cn } from '@/lib/utils'

function iconFor(kind: RenderedArtifact['kind']) {
  if (kind === 'image') return FileImage
  if (kind === 'html') return FileCode
  if (kind === 'pdf') return FileType
  return FileText // markdown
}

export function ArtifactCard({ toolCalls }: { toolCalls?: ToolCall[] }) {
  const { t } = useTranslation()
  const { scopeId, isDraft } = useFsScope()
  const artifacts = extractRenderedArtifacts(toolCalls)
  if (artifacts.length === 0) return null

  const canPreview = scopeId != null

  const open = (path: string) => {
    if (!scopeId) return
    // Drive the existing FS preview pipeline (same as FileTree's Node.onClick).
    useFsStore.getState().setActive(scopeId, path)
    if (isDraft) sessionService.readDraftFile(scopeId, path)
    else sessionService.readFile(scopeId, path)
    // Smart auto-open: if the panel is closed, open it then defer the tab switch one tick so the
    // Files tab mounts after the panel (avoids a mount race). If already open, switch synchronously.
    const ui = useUiStore.getState()
    if (!ui.panelOpen) {
      ui.setPanelOpen(true)
      setTimeout(() => useUiStore.getState().setTab('files'), 0)
    } else {
      ui.setTab('files')
    }
  }

  return (
    <div data-testid="artifact-card" className="mt-2 overflow-hidden rounded-md border border-border bg-surface-muted/40">
      <div className="border-b border-border px-3 py-1.5 text-meta font-medium text-ink-secondary">
        {t('artifact.turnOutputs', { count: artifacts.length })}
      </div>
      <ul>
        {artifacts.map((a) => {
          const Icon = iconFor(a.kind)
          return (
            <li key={a.path}>
              <button
                type="button"
                data-testid="artifact-row"
                data-path={a.path}
                onClick={canPreview ? () => open(a.path) : undefined}
                disabled={!canPreview}
                title={a.path}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-body text-ink transition-colors',
                  canPreview ? 'cursor-pointer hover:bg-surface-muted' : 'cursor-default opacity-70',
                )}
              >
                <Icon size={15} className="shrink-0 text-ink-tertiary" />
                <span className="truncate">{a.name}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
