import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Copy, Download } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'
import { useFsScope } from '@/store/useFsScope'
import { useFsStore } from '@/store/fsStore'
import { useActiveMessages, sessionService } from '@/domain'
import { collectConversationArtifacts } from '@/lib/renderedArtifacts'
import { iconFor } from './ArtifactCard'
import { FilePreview } from './FilePreview'
import { ConversationOutline } from './ConversationOutline'
import { SearchSourcesPanel } from './SearchSourcesPanel'
import { PanelToggle } from '@/components/layout/PanelToggle'
import { PanelTabBar } from './PanelTabBar'
import { titlebarIconBtnClass } from '@/components/layout/titlebarChrome'
import { focusChrome } from '@/components/ui/focusClasses'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import { cn } from '@/lib/utils'

/** Decode a base64 string to bytes (for downloading image/pdf artifacts). */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function PreviewPanel() {
  const { t } = useTranslation()
  const { scopeId, isDraft } = useFsScope()
  const messages = useActiveMessages()
  const artifacts = collectConversationArtifacts(messages)
  const selected = useUiStore((s) => s.selectedArtifactPath)
  const chatActiveTab = useUiStore((s) => s.chatActiveTab)
  const preview = useFsStore((s) => (scopeId ? s.bySession[scopeId]?.preview : undefined))

  const select = (path: string) => {
    if (!scopeId) return
    useFsStore.getState().setActive(scopeId, path)
    if (isDraft) sessionService.readDraftFile(scopeId, path)
    else sessionService.readFile(scopeId, path)
    useUiStore.getState().setSelectedArtifactPath(path)
  }

  const ready = preview && preview.status === 'ready' && preview.content != null
  const copy = () => { if (ready && preview.encoding !== 'base64') void navigator.clipboard?.writeText(preview.content!) }
  const download = () => {
    if (!ready || preview.path == null) return
    const p = preview.path
    const name = p.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || 'artifact'
    const blob = preview.encoding === 'base64'
      ? new Blob([base64ToBytes(preview.content!)], { type: preview.mimeType || 'application/octet-stream' })
      : new Blob([preview.content!], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = name; a.click()
    URL.revokeObjectURL(url)
  }

  const previewPath = preview && preview.status !== 'idle' ? preview.path : undefined
  const currentArtifact =
    artifacts.find((a) => a.path === selected) ??
    artifacts.find((a) => a.path === previewPath) ??
    artifacts[0]
  const showFileActions = chatActiveTab === 'files' && artifacts.length > 0

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-border bg-surface">
      <div
        data-tauri-drag-region
        className="flex h-[var(--titlebar-height)] shrink-0 items-center gap-1 px-2"
      >
        {/* Left: fill the former empty drag strip with file actions + switcher */}
        <div
          className="flex min-w-0 flex-1 items-center gap-0.5"
          data-tauri-drag-region="false"
        >
          {showFileActions && ready && (
            <>
              <button
                type="button"
                className={cn(titlebarIconBtnClass, 'disabled:pointer-events-none disabled:opacity-40')}
                onClick={copy}
                title={t('artifact.copyArtifact')}
                disabled={preview?.encoding === 'base64'}
                data-testid="preview-copy"
              >
                <Copy size={15} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                className={titlebarIconBtnClass}
                onClick={download}
                title={t('artifact.downloadArtifact')}
                data-testid="preview-download"
              >
                <Download size={15} strokeWidth={1.75} />
              </button>
            </>
          )}
          {showFileActions && currentArtifact && (
            artifacts.length === 1 ? (
              <span
                className="min-w-0 truncate px-1.5 text-meta text-ink-secondary"
                title={currentArtifact.path}
                data-testid="preview-artifact-name"
              >
                {currentArtifact.name}
              </span>
            ) : (
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    title={currentArtifact.path}
                    data-testid="preview-artifact-switcher"
                    className={cn(
                      'inline-flex h-7 max-w-[12rem] items-center gap-1 rounded-sm px-1.5 text-meta font-medium text-ink transition-colors duration-chrome hover:bg-state-hover',
                      focusChrome,
                    )}
                  >
                    <span className="truncate">{currentArtifact.name}</span>
                    <ChevronDown size={14} strokeWidth={1.75} className="shrink-0 text-ink-tertiary" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" data-testid="preview-artifact-menu">
                  {artifacts.map((a) => {
                    const Icon = iconFor(a.kind)
                    const isSelected = (selected ?? currentArtifact.path) === a.path
                    return (
                      <DropdownMenuItem
                        key={a.path}
                        onSelect={() => select(a.path)}
                        data-testid={`preview-artifact-${a.name}`}
                      >
                        <span className="flex w-4 shrink-0 items-center justify-center">
                          {isSelected ? <Check size={14} className="text-accent" /> : <Icon size={14} className="text-ink-tertiary" />}
                        </span>
                        <span className="truncate">{a.name}</span>
                      </DropdownMenuItem>
                    )
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )
          )}
          {/* Remaining strip stays draggable */}
          <div className="min-h-full min-w-2 flex-1" data-tauri-drag-region />
        </div>
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
