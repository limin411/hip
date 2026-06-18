import { useTranslation } from 'react-i18next'
import { X, Copy, Download } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'
import { useFsScope } from '@/store/useFsScope'
import { useFsStore } from '@/store/fsStore'
import { useActiveMessages, sessionService } from '@/domain'
import { collectConversationArtifacts } from '@/lib/renderedArtifacts'
import { iconFor } from './ArtifactCard'
import { FilePreview } from './FilePreview'
import { Button } from '@/components/ui/Button'
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
  const toggleChatPanel = useUiStore((s) => s.toggleChatPanel)
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
    if (!ready || selected == null) return
    const name = selected.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || 'artifact'
    const blob = preview.encoding === 'base64'
      ? new Blob([base64ToBytes(preview.content!)], { type: preview.mimeType || 'application/octet-stream' })
      : new Blob([preview.content!], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = name; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex h-full animate-panel-in flex-col bg-surface">
      <div data-tauri-drag-region className="flex h-11 shrink-0 items-center justify-between border-b border-border px-2">
        <span className="truncate pl-1 text-body font-medium text-ink" data-tauri-drag-region="false">
          {selected ? (selected.split(/[/\\]/).pop() || selected) : t('artifact.files')}
        </span>
        <div className="flex items-center gap-1" data-tauri-drag-region="false">
          <Button variant="ghost" size="icon" onClick={copy} title={t('artifact.copyArtifact')} disabled={!ready || preview?.encoding === 'base64'}>
            <Copy size={15} />
          </Button>
          <Button variant="ghost" size="icon" onClick={download} title={t('artifact.downloadArtifact')} disabled={!ready}>
            <Download size={15} />
          </Button>
          <Button variant="ghost" size="icon" onClick={toggleChatPanel} title={t('artifact.closePanel')}>
            <X size={16} />
          </Button>
        </div>
      </div>

      {artifacts.length === 0 ? (
        <div className="flex h-full items-center justify-center p-6 text-center text-body text-ink-tertiary" data-testid="preview-no-artifacts">
          {t('artifact.noArtifacts')}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <ul className="w-40 shrink-0 overflow-y-auto border-r border-border py-1">
            {artifacts.map((a) => {
              const Icon = iconFor(a.kind)
              return (
                <li key={a.path}>
                  <button
                    type="button"
                    onClick={() => select(a.path)}
                    title={a.path}
                    className={cn(
                      'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-meta transition-colors',
                      selected === a.path ? 'bg-accent-active text-accent-strong' : 'text-ink hover:bg-surface-muted',
                    )}
                  >
                    <Icon size={14} className="shrink-0 text-ink-tertiary" />
                    <span className="truncate">{a.name}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="min-w-0 flex-1"><FilePreview /></div>
        </div>
      )}
    </div>
  )
}
