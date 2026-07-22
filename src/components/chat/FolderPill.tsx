import { useMemo } from 'react'
import { Check, ChevronDown, Folder, History, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSessions } from '@/domain'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import { pickDirectory } from '@/ipc/dialog'
import { listOpenProjectFolders, projectPathKey } from '@/lib/sessionProjectGroups'
import { cn } from '@/lib/utils'
import { useDraftStore } from '@/store/draftStore'

function basename(p: string): string {
  const a = p.replace(/[/\\]+$/, '').split(/[/\\]/)
  return a[a.length - 1] || p
}

export function FolderPill() {
  const { t } = useTranslation()
  const draft = useDraftStore((s) => s.draft)
  const sessions = useSessions()
  const bound = draft?.mode === 'project' && draft.cwd ? draft.cwd : null
  const boundKey = projectPathKey(bound)

  const openFolders = useMemo(() => listOpenProjectFolders(sessions), [sessions])

  const pick = async () => {
    const dir = await pickDirectory()
    if (!dir) return
    useDraftStore.getState().pickProject(dir)
    // Intentionally not opening any panel here. FolderPill is rendered in
    // NewConversation, which has no active session; session-scoped panels
    // require an active session to know where to write their open state.
  }

  const selectOpen = (cwd: string) => {
    useDraftStore.getState().pickProject(cwd)
  }

  const quickSelect =
    openFolders.length > 0 ? (
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="quick-pick-folder"
            title={t('chat.quickPickFolderHint')}
            aria-label={t('chat.quickPickFolderAria')}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-meta text-ink-secondary transition-colors hover:bg-surface-muted"
          >
            <History size={13} className="text-ink-tertiary" aria-hidden />
            <ChevronDown size={12} className="text-ink-tertiary" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-w-[min(360px,calc(100vw-2rem))]">
          <DropdownMenuLabel>{t('chat.quickPickFolder')}</DropdownMenuLabel>
          {openFolders.map((f) => {
            const selected = boundKey !== '' && f.pathKey === boundKey
            return (
              <DropdownMenuItem
                key={f.pathKey}
                data-testid="quick-pick-folder-item"
                data-path={f.pathKey}
                title={f.cwd}
                onSelect={() => selectOpen(f.cwd)}
              >
                <Check
                  size={14}
                  className={cn('shrink-0', selected ? 'opacity-100' : 'opacity-0')}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{f.label}</span>
                  <span className="block truncate text-caption text-ink-tertiary">{f.cwd}</span>
                </span>
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null

  if (bound) {
    return (
      <div className="flex items-center gap-1.5" data-testid="folder-pill-row">
        {quickSelect}
        <div
          className="flex items-center overflow-hidden rounded-md border border-accent/30 bg-accent-subtle text-meta text-accent-strong"
          data-testid="folder-chip"
        >
          <button
            type="button"
            onClick={pick}
            data-testid="change-folder"
            title={bound}
            className="flex items-center gap-1.5 py-1 pl-2.5 pr-1.5 transition-colors hover:bg-accent-active"
          >
            <Folder size={13} className="text-accent-strong" />
            {basename(bound)}
          </button>
          <button
            type="button"
            onClick={() => useDraftStore.getState().clearProject()}
            data-testid="clear-folder"
            title={t('chat.clearFolder')}
            aria-label={t('chat.clearFolder')}
            className="flex items-center py-1 pl-1 pr-1.5 transition-colors hover:bg-accent-active"
          >
            <X size={13} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5" data-testid="folder-pill-row">
      {quickSelect}
      <button
        type="button"
        onClick={pick}
        data-testid="pick-folder"
        className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-meta text-ink-secondary transition-colors hover:bg-surface-muted"
      >
        <Folder size={13} className="text-ink-tertiary" />
        {t('chat.pickFolder')}
      </button>
    </div>
  )
}
