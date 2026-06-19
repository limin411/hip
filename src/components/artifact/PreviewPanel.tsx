import { useTranslation } from 'react-i18next'
import { X, Copy, Download } from 'lucide-react'
import type { ChatTab } from '@/store/uiStore'
import { useUiStore } from '@/store/uiStore'
import { useFsScope } from '@/store/useFsScope'
import { useFsStore } from '@/store/fsStore'
import { useActiveMessages, sessionService } from '@/domain'
import { collectConversationArtifacts } from '@/lib/renderedArtifacts'
import { iconFor } from './ArtifactCard'
import { FilePreview } from './FilePreview'
import { AgentDashboard } from './AgentDashboard'
import { Button } from '@/components/ui/Button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs'
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
  const chatActiveTab = useUiStore((s) => s.chatActiveTab)
  const setChatActiveTab = useUiStore((s) => s.setChatActiveTab)
  const resetChatActiveTab = useUiStore((s) => s.resetChatActiveTab)
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

  const close = () => {
    resetChatActiveTab()
    toggleChatPanel()
  }

  return (
    <div className="flex h-full animate-panel-in flex-col bg-surface">
      <Tabs value={chatActiveTab} onValueChange={(v) => setChatActiveTab(v as ChatTab)} className="flex h-full flex-col">
        <div data-tauri-drag-region className="flex h-11 shrink-0 items-center justify-between border-b border-border px-2">
          <TabsList className="h-full gap-4" data-tauri-drag-region="false">
            <TabsTrigger value="files">{t('artifact.files')}</TabsTrigger>
            <TabsTrigger value="agents">{t('artifact.agents')}</TabsTrigger>
          </TabsList>
          <Button variant="ghost" size="icon" onClick={close} title={t('artifact.closePanel')} data-tauri-drag-region="false">
            <X size={16} />
          </Button>
        </div>

        <TabsContent value="files" className="flex-1 overflow-hidden p-0">
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
              <div className="min-w-0 flex-1">
                {ready && (
                  <div className="flex items-center gap-1 border-b border-border px-2 py-1">
                    <Button variant="ghost" size="icon" onClick={copy} title={t('artifact.copyArtifact')} disabled={!ready || preview?.encoding === 'base64'}>
                      <Copy size={15} />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={download} title={t('artifact.downloadArtifact')} disabled={!ready}>
                      <Download size={15} />
                    </Button>
                  </div>
                )}
                <FilePreview />
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="agents" className="flex-1 overflow-auto p-3">
          <AgentDashboard />
        </TabsContent>
      </Tabs>
    </div>
  )
}
