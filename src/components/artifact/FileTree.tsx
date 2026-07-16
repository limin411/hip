import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, FolderGit2, RefreshCw, MessageSquare } from 'lucide-react'
import type { FsEntry } from '@hip/protocol'
import { sessionService } from '@/domain'
import { useFsStore } from '@/store/fsStore'
import { useFsScope } from '@/store/useFsScope'
import { useDraftStore } from '@/store/draftStore'
import { pickDirectory } from '@/ipc/dialog'
import { Button } from '@/components/ui/Button'
import { DeclarativeContextMenu } from '@/components/context-menu'
import { cn } from '@/lib/utils'

function basename(p: string): string {
  if (typeof p !== 'string' || !p) return ''
  const parts = p.replace(/[/\\]+$/, '').split(/[/\\]/)
  return parts[parts.length - 1] || p
}

/** Only treat a real non-empty string as a bound workspace root. */
function asRootPath(cwd: unknown): string | undefined {
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
}

function Node({
  entry,
  scopeId,
  isDraft,
  depth,
  cwd,
}: {
  entry: FsEntry
  scopeId: string
  isDraft: boolean
  depth: number
  cwd: string | null
}) {
  const open = useFsStore((s) => !!s.bySession[scopeId]?.expanded[entry.path])
  const active = useFsStore((s) => s.bySession[scopeId]?.activePath === entry.path)
  const children = useFsStore((s) => s.bySession[scopeId]?.entriesByDir[entry.path])

  const onClick = () => {
    if (entry.isDir) {
      useFsStore.getState().toggleExpanded(scopeId, entry.path)
      if (!children) {
        if (isDraft) sessionService.lsDraft(scopeId, entry.path)
        else sessionService.lsDir(scopeId, entry.path)
      }
    } else {
      useFsStore.getState().setActive(scopeId, entry.path)
      if (isDraft) sessionService.readDraftFile(scopeId, entry.path)
      else sessionService.readFile(scopeId, entry.path)
    }
  }

  return (
    <div>
      <DeclarativeContextMenu
        kind="fileEntry"
        payload={{
          path: entry.path,
          name: entry.name,
          isDir: entry.isDir,
          scopeId,
          isDraft,
          cwd,
        }}
      >
        <div
          data-testid="tree-entry"
          data-path={entry.path}
          onClick={onClick}
          className={cn(
            'flex cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2 text-body transition-colors',
            active ? 'bg-accent-active font-medium text-accent-strong' : 'text-ink hover:bg-surface-muted',
          )}
          style={{ paddingLeft: depth * 14 + 6 }}
        >
          {entry.isDir
            ? open ? <ChevronDown size={14} className="text-ink-tertiary" /> : <ChevronRight size={14} className="text-ink-tertiary" />
            : <span className="w-3.5" />}
          {entry.isDir
            ? open ? <FolderOpen size={15} className="text-accent-strong" /> : <Folder size={15} className="text-accent-strong" />
            : <File size={15} className="text-ink-tertiary" />}
          <span className="truncate">{entry.name}</span>
        </div>
      </DeclarativeContextMenu>
      {entry.isDir && open && children?.map((c) => (
        <Node key={c.path} entry={c} scopeId={scopeId} isDraft={isDraft} depth={depth + 1} cwd={cwd} />
      ))}
    </div>
  )
}

export function FileTree() {
  const { t } = useTranslation()
  const { scopeId, cwd, isDraft, chatDraft } = useFsScope()
  // Guard non-string cwd (malformed session config / browser E2E) — never call path ops on it.
  const rootPath = asRootPath(cwd)
  const rootEntries = useFsStore((s) =>
    scopeId && rootPath ? s.bySession[scopeId]?.entriesByDir[rootPath] : undefined,
  )

  // Load the root listing once a workspace is bound and not yet cached.
  useEffect(() => {
    if (scopeId && rootPath && !rootEntries) {
      if (isDraft) sessionService.lsDraft(scopeId, rootPath)
      else sessionService.lsDir(scopeId, rootPath)
    }
  }, [scopeId, rootPath, isDraft, rootEntries])

  const choose = async () => {
    const dir = await pickDirectory()
    if (!dir) return
    if (!isDraft && scopeId) sessionService.setProjectDir(scopeId, dir)
    else useDraftStore.getState().pickProject(dir)
  }

  if (!rootPath) {
    if (chatDraft) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-ink-tertiary" data-testid="file-tree">
          <Folder size={32} className="opacity-40" />
          <div className="max-w-[220px] text-body">{t('artifact.sandboxPending')}</div>
        </div>
      )
    }
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-ink-tertiary" data-testid="file-tree">
        <Folder size={32} className="opacity-40" />
        <div className="max-w-[200px] text-body">{t('artifact.selectFolderDesc')}</div>
        <Button data-testid="select-folder" onClick={choose} variant="primary" size="sm">
          {t('artifact.selectFolder')}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col" data-testid="file-tree">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-2">
        <span className="flex items-center gap-1.5 truncate text-meta font-medium text-ink-secondary" title={rootPath}>
          <FolderGit2 size={13} className="shrink-0 text-ink-tertiary" />
          {basename(rootPath)}
        </span>
        <div className="flex items-center gap-0.5">
          {isDraft && (
            <button
              title={t('artifact.backToChat')}
              aria-label={t('artifact.backToChat')}
              data-testid="tree-back-to-chat"
              onClick={() => useDraftStore.getState().clearProject()}
              className="rounded p-1 text-accent-strong transition-colors hover:bg-surface-muted"
            >
              <MessageSquare size={13} />
            </button>
          )}
          <button
            title={t('artifact.refresh')}
            data-testid="refresh-tree"
            onClick={() => scopeId && (isDraft ? sessionService.lsDraft(scopeId, rootPath) : sessionService.lsDir(scopeId, rootPath))}
            className="rounded p-1 text-ink-tertiary transition-colors hover:bg-surface-muted hover:text-ink"
          >
            <RefreshCw size={13} />
          </button>
          <button
            title={t('artifact.changeFolder')}
            onClick={choose}
            className="rounded p-1 text-ink-tertiary transition-colors hover:bg-surface-muted hover:text-ink"
          >
            <Folder size={13} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto py-1">
        {scopeId && rootEntries?.map((e) => (
          <Node key={e.path} entry={e} scopeId={scopeId} isDraft={isDraft} depth={0} cwd={rootPath} />
        ))}
      </div>
    </div>
  )
}
