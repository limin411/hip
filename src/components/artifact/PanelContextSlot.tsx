import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Copy, Download, Power, RotateCcw } from 'lucide-react'
import type { ArtifactTab, ChatTab } from '@/store/uiStore'
import { useUiStore } from '@/store/uiStore'
import { useFsScope } from '@/store/useFsScope'
import { useFsStore } from '@/store/fsStore'
import { useDomainStore } from '@/domain/sessionStore'
import { useActiveMessages, sessionService } from '@/domain'
import { useDiffStore } from '@/store/diffStore'
import { collectConversationArtifacts } from '@/lib/renderedArtifacts'
import { collectUserTurns } from '@/lib/conversationOutline'
import { collectConversationSearchSources } from '@/lib/searchSources'
import { copyText } from '@/ipc/clipboard'
import { titlebarIconBtnClass } from '@/components/layout/titlebarChrome'
import { focusChrome } from '@/components/ui/focusClasses'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import { cn } from '@/lib/utils'
import { iconFor } from './ArtifactCard'
import { CODE_TERMINAL } from './terminalFeature'
import { useCodeTerminalControllerOptional } from './codeTerminalController'
import { pathBasename } from './panelContextSlotModel'
import { ChangesTitlebarActions } from './ChangesTitlebarActions'

const GIT_GATED: ReadonlySet<ArtifactTab> = new Set(['changes'])

function resolveEffectiveTab(activeTab: ArtifactTab, isGitRepo: boolean): ArtifactTab {
  if (GIT_GATED.has(activeTab) && !isGitRepo) return 'files'
  if (activeTab === 'terminal' && !CODE_TERMINAL) return 'files'
  return activeTab
}

/** Decode a base64 string to bytes (for downloading image/pdf artifacts). */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function SlotShell({ children }: { children?: ReactNode }) {
  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-0.5"
      data-tauri-drag-region="false"
      data-testid="panel-context-slot"
    >
      {children}
      <div className="min-h-full min-w-2 flex-1" data-tauri-drag-region />
    </div>
  )
}

function IdentityText({
  text,
  title,
  testid,
  mono,
}: {
  text: string
  title?: string
  testid: string
  mono?: boolean
}) {
  return (
    <span
      className={cn(
        'min-w-0 max-w-[10rem] truncate px-1.5 text-meta text-ink-secondary sm:max-w-[14rem]',
        mono && 'font-mono text-caption',
      )}
      title={title ?? text}
      data-testid={testid}
    >
      {text}
    </span>
  )
}

function CountIdentity({ label, count, testid }: { label: string; count: number; testid: string }) {
  const text = count > 0 ? `${label} · ${count}` : label
  return <IdentityText text={text} testid={testid} />
}

function CodeFilesSlot() {
  const { t } = useTranslation()
  const { scopeId, cwd } = useFsScope()
  const preview = useFsStore((s) => (scopeId ? s.bySession[scopeId]?.preview : undefined))
  const ready = preview && preview.status === 'ready' && preview.content != null
  const path =
    preview && preview.status !== 'idle' && preview.path ? preview.path : undefined
  const identity = path
    ? pathBasename(path)
    : cwd
      ? pathBasename(cwd)
      : t('artifact.selectFileToPreview')

  const canCopyContent = !!(ready && preview.encoding !== 'base64' && preview.content != null)
  const copy = () => {
    if (canCopyContent) void copyText(preview.content!)
    else if (path) void copyText(path)
  }

  return (
    <SlotShell>
      {(canCopyContent || path) && (
        <button
          type="button"
          className={titlebarIconBtnClass}
          onClick={copy}
          title={canCopyContent ? t('artifact.copyArtifact') : t('contextMenu.filePreview.copyPath')}
          data-testid={canCopyContent ? 'slot-copy-content' : 'slot-copy-path'}
        >
          <Copy size={15} strokeWidth={1.75} />
        </button>
      )}
      <IdentityText
        text={identity}
        title={path ?? cwd}
        testid="slot-files-identity"
        mono={!!path || !!cwd}
      />
    </SlotShell>
  )
}

function ChatFilesSlot() {
  const { t } = useTranslation()
  const { scopeId, isDraft } = useFsScope()
  const messages = useActiveMessages()
  const artifacts = collectConversationArtifacts(messages)
  const selected = useUiStore((s) => s.selectedArtifactPath)
  const preview = useFsStore((s) => (scopeId ? s.bySession[scopeId]?.preview : undefined))

  const select = (path: string) => {
    if (!scopeId) return
    useFsStore.getState().setActive(scopeId, path)
    if (isDraft) sessionService.readDraftFile(scopeId, path)
    else sessionService.readFile(scopeId, path)
    useUiStore.getState().setSelectedArtifactPath(path)
  }

  const ready = preview && preview.status === 'ready' && preview.content != null
  const copy = () => {
    if (ready && preview.encoding !== 'base64') void navigator.clipboard?.writeText(preview.content!)
  }
  const download = () => {
    if (!ready || preview.path == null) return
    const p = preview.path
    const name = p.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || 'artifact'
    const blob =
      preview.encoding === 'base64'
        ? new Blob([base64ToBytes(preview.content!)], {
            type: preview.mimeType || 'application/octet-stream',
          })
        : new Blob([preview.content!], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }

  const previewPath = preview && preview.status !== 'idle' ? preview.path : undefined
  const currentArtifact =
    artifacts.find((a) => a.path === selected) ??
    artifacts.find((a) => a.path === previewPath) ??
    artifacts[0]
  const showFileActions = artifacts.length > 0

  if (!showFileActions) {
    return <SlotShell />
  }

  return (
    <SlotShell>
      {ready && (
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
      {currentArtifact &&
        (artifacts.length === 1 ? (
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
                      {isSelected ? (
                        <Check size={14} className="text-accent" />
                      ) : (
                        <Icon size={14} className="text-ink-tertiary" />
                      )}
                    </span>
                    <span className="truncate">{a.name}</span>
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        ))}
    </SlotShell>
  )
}

function OutlineSlot() {
  const { t } = useTranslation()
  const messages = useActiveMessages()
  const turns = useMemo(() => collectUserTurns(messages), [messages])
  return (
    <SlotShell>
      <CountIdentity
        label={t('artifact.outline')}
        count={turns.length}
        testid="slot-outline-identity"
      />
    </SlotShell>
  )
}

function SourcesSlot() {
  const { t } = useTranslation()
  const messages = useActiveMessages()
  const sources = useMemo(() => collectConversationSearchSources(messages), [messages])
  return (
    <SlotShell>
      <CountIdentity
        label={t('artifact.sources')}
        count={sources.length}
        testid="slot-sources-identity"
      />
    </SlotShell>
  )
}

function TerminalSlot() {
  const { t } = useTranslation()
  const ctrl = useCodeTerminalControllerOptional()
  if (!ctrl || !ctrl.sessionId) {
    return (
      <SlotShell>
        <IdentityText text={t('artifact.terminal')} testid="slot-terminal-identity" />
      </SlotShell>
    )
  }

  const { cwd, closed, restart, close } = ctrl
  const identity = cwd ? pathBasename(cwd) : t('artifact.terminalView.noCwd')

  return (
    <SlotShell>
      <IdentityText
        text={identity}
        title={cwd}
        testid="terminal-cwd"
        mono={!!cwd}
      />
      {cwd && (
        <>
          <button
            type="button"
            className={titlebarIconBtnClass}
            onClick={() => void restart()}
            title={t('artifact.terminalView.restart')}
            data-testid="terminal-restart"
          >
            <RotateCcw size={15} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            className={cn(titlebarIconBtnClass, 'disabled:pointer-events-none disabled:opacity-40')}
            onClick={() => void close()}
            disabled={closed}
            title={t('artifact.terminalView.close')}
            data-testid="terminal-close"
          >
            <Power size={15} strokeWidth={1.75} />
          </button>
        </>
      )}
    </SlotShell>
  )
}

/**
 * Right-rail titlebar left slot: tab-contextual identity + primary actions.
 * Tabs stay on the right edge (PanelTabBar); this fills the former empty drag strip.
 */
export function PanelContextSlot({ surface }: { surface: 'code' | 'chat' }) {
  const activeTab = useUiStore((s) => s.activeTab)
  const chatActiveTab = useUiStore((s) => s.chatActiveTab) as ChatTab
  const sid = useDomainStore((s) => s.activeSessionId)
  const isGitRepo = useDiffStore((s) => (sid ? s.bySession[sid]?.isGitRepo : false)) ?? false
  let body: ReactNode
  if (surface === 'chat') {
    if (chatActiveTab === 'outline') body = <OutlineSlot />
    else if (chatActiveTab === 'sources') body = <SourcesSlot />
    else body = <ChatFilesSlot />
  } else {
    const tab = resolveEffectiveTab(activeTab, isGitRepo)
    if (tab === 'outline') body = <OutlineSlot />
    else if (tab === 'changes') body = <ChangesTitlebarActions />
    else if (tab === 'terminal') body = <TerminalSlot />
    else body = <CodeFilesSlot />
  }

  return <div className="flex min-w-0 flex-1">{body}</div>
}
