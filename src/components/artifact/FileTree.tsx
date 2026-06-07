import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, FolderGit2, RefreshCw } from 'lucide-react'
import type { FsEntry } from '@hip/protocol'
import { useActiveSession, sessionService } from '@/domain'
import { useFsStore } from '@/store/fsStore'
import { pickDirectory } from '@/ipc/dialog'
import { cn } from '@/lib/utils'

function basename(p: string): string {
  const parts = p.replace(/[/\\]+$/, '').split(/[/\\]/)
  return parts[parts.length - 1] || p
}

function Node({ entry, sessionId, depth }: { entry: FsEntry; sessionId: string; depth: number }) {
  const open = useFsStore((s) => !!s.bySession[sessionId]?.expanded[entry.path])
  const active = useFsStore((s) => s.bySession[sessionId]?.activePath === entry.path)
  const children = useFsStore((s) => s.bySession[sessionId]?.entriesByDir[entry.path])

  const onClick = () => {
    if (entry.isDir) {
      useFsStore.getState().toggleExpanded(sessionId, entry.path)
      if (!children) sessionService.lsDir(sessionId, entry.path)
    } else {
      useFsStore.getState().setActive(sessionId, entry.path)
      sessionService.readFile(sessionId, entry.path)
    }
  }

  return (
    <div>
      <div
        data-testid="tree-entry"
        data-path={entry.path}
        onClick={onClick}
        className={cn(
          'flex cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2 text-[13px] transition-colors',
          active ? 'bg-accent-subtle text-accent' : 'text-ink hover:bg-surface-muted',
        )}
        style={{ paddingLeft: depth * 14 + 6 }}
      >
        {entry.isDir
          ? open ? <ChevronDown size={14} className="text-ink-tertiary" /> : <ChevronRight size={14} className="text-ink-tertiary" />
          : <span className="w-3.5" />}
        {entry.isDir
          ? open ? <FolderOpen size={15} className="text-accent" /> : <Folder size={15} className="text-accent" />
          : <File size={15} className="text-ink-tertiary" />}
        <span className="truncate">{entry.name}</span>
      </div>
      {entry.isDir && open && children?.map((c) => <Node key={c.path} entry={c} sessionId={sessionId} depth={depth + 1} />)}
    </div>
  )
}

export function FileTree() {
  const { t } = useTranslation()
  const active = useActiveSession()
  const sessionId = active?.id ?? null
  const cwd = active?.config.cwd
  const rootEntries = useFsStore((s) => (sessionId && cwd ? s.bySession[sessionId]?.entriesByDir[cwd] : undefined))

  // Load the root listing once a workspace is bound and not yet cached.
  useEffect(() => {
    if (sessionId && cwd && !rootEntries) sessionService.lsDir(sessionId, cwd)
  }, [sessionId, cwd, rootEntries])

  const choose = async () => {
    const sid = sessionId ?? sessionService.createSession()
    const dir = await pickDirectory()
    if (dir) sessionService.setProjectDir(sid, dir)
  }

  if (!cwd) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-ink-tertiary" data-testid="file-tree">
        <Folder size={32} className="opacity-40" />
        <div className="max-w-[200px] text-[13px]">{t('artifact.selectFolderDesc')}</div>
        <button
          data-testid="select-folder"
          onClick={choose}
          className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover"
        >
          {t('artifact.selectFolder')}
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col" data-testid="file-tree">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-2">
        <span className="flex items-center gap-1.5 truncate text-[12px] font-medium text-ink-secondary" title={cwd}>
          <FolderGit2 size={13} className="shrink-0 text-ink-tertiary" />
          {basename(cwd)}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            title={t('artifact.refresh')}
            data-testid="refresh-tree"
            onClick={() => sessionId && sessionService.lsDir(sessionId, cwd)}
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
        {sessionId && rootEntries?.map((e) => <Node key={e.path} entry={e} sessionId={sessionId} depth={0} />)}
      </div>
    </div>
  )
}
