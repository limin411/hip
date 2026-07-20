import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  RefreshCw,
  Upload,
} from 'lucide-react'
import type { SftpEntry } from '@/ipc/sftp'
import { useTerminalFsStore } from '@/store/terminalFsStore'
import { DeclarativeContextMenu } from '@/components/context-menu'
import {
  loadSftpDir,
  refreshSftpDir,
  runSftpUploadIntoDir,
} from '@/components/terminals/sftpActions'
import { cn } from '@/lib/utils'

export { refreshSftpDir }

function basename(p: string): string {
  if (!p) return ''
  const parts = p.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || p
}

function Node({
  entry,
  terminalId,
  depth,
}: {
  entry: SftpEntry
  terminalId: string
  depth: number
}) {
  const open = useTerminalFsStore((s) => !!s.byTerminal[terminalId]?.expanded[entry.path])
  const children = useTerminalFsStore(
    (s) => s.byTerminal[terminalId]?.entriesByDir[entry.path],
  )
  const loading = useTerminalFsStore(
    (s) => !!s.byTerminal[terminalId]?.loading[entry.path],
  )
  const dirError = useTerminalFsStore(
    (s) => s.byTerminal[terminalId]?.dirErrors?.[entry.path] ?? null,
  )

  const onClick = () => {
    if (!entry.isDir) return
    useTerminalFsStore.getState().toggleExpanded(terminalId, entry.path)
    const slice = useTerminalFsStore.getState().byTerminal[terminalId]
    const hasChildren = !!slice?.entriesByDir[entry.path]
    if (!hasChildren) {
      void loadSftpDir(terminalId, entry.path)
    }
  }

  return (
    <div>
      <DeclarativeContextMenu
        kind="sftpEntry"
        payload={{
          terminalId,
          path: entry.path,
          name: entry.name,
          isDir: entry.isDir,
        }}
      >
        <div
          data-testid="sftp-tree-entry"
          data-path={entry.path}
          data-dir={entry.isDir ? '1' : '0'}
          onClick={onClick}
          className={cn(
            'flex cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2 text-body transition-colors duration-chrome',
            'text-ink hover:bg-state-hover',
          )}
          style={{ paddingLeft: depth * 12 + 4 }}
        >
          {entry.isDir ? (
            open ? (
              <ChevronDown size={13} strokeWidth={1.75} className="shrink-0 text-ink-tertiary" />
            ) : (
              <ChevronRight size={13} strokeWidth={1.75} className="shrink-0 text-ink-tertiary" />
            )
          ) : (
            <span className="w-3.5 shrink-0" />
          )}
          {entry.isDir ? (
            open ? (
              <FolderOpen size={14} strokeWidth={1.75} className="shrink-0 text-ink-tertiary" />
            ) : (
              <Folder size={14} strokeWidth={1.75} className="shrink-0 text-ink-tertiary" />
            )
          ) : (
            <File size={14} strokeWidth={1.75} className="shrink-0 text-ink-tertiary" />
          )}
          <span className="truncate" title={entry.path}>
            {entry.name}
          </span>
          {loading ? (
            <span className="ml-auto text-caption text-ink-tertiary">…</span>
          ) : null}
        </div>
      </DeclarativeContextMenu>
      {entry.isDir && open && dirError ? (
        <p
          className="truncate px-2 py-0.5 text-caption text-red-500/90"
          style={{ paddingLeft: (depth + 1) * 12 + 4 }}
          data-testid="sftp-dir-error"
          title={dirError}
        >
          {dirError}
        </p>
      ) : null}
      {entry.isDir && open && children?.map((c) => (
        <Node key={c.path} entry={c} terminalId={terminalId} depth={depth + 1} />
      ))}
    </div>
  )
}

export function TerminalFileTree({
  terminalId,
  initialPath,
}: {
  terminalId: string
  /** Host remotePath or empty (home). */
  initialPath?: string
}) {
  const { t } = useTranslation()
  const rootPath = useTerminalFsStore((s) => s.byTerminal[terminalId]?.rootPath ?? null)
  const error = useTerminalFsStore((s) => s.byTerminal[terminalId]?.error ?? null)
  const rootEntries = useTerminalFsStore((s) => {
    const slice = s.byTerminal[terminalId]
    if (!slice) return undefined
    const key = slice.rootPath
    if (key) return slice.entriesByDir[key]
    return undefined
  })
  const loadingRoot = useTerminalFsStore((s) => {
    const slice = s.byTerminal[terminalId]
    if (!slice) return false
    const key = slice.rootPath ?? initialPath ?? '.'
    return !!slice.loading[key] || !!slice.loading['.'] || !!slice.loading['']
  })

  const startPath = initialPath?.trim() || '.'

  const reload = useCallback(() => {
    void loadSftpDir(terminalId, rootPath ?? startPath)
  }, [terminalId, rootPath, startPath])

  useEffect(() => {
    if (!rootPath && !rootEntries) {
      void loadSftpDir(terminalId, startPath)
    }
  }, [terminalId, startPath, rootPath, rootEntries])

  if (error === 'session_closed') {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center text-caption text-ink-tertiary"
        data-testid="sftp-session-closed"
      >
        {t('terminals.sftp.sessionClosed')}
      </div>
    )
  }

  if (error && !rootEntries) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center"
        data-testid="sftp-tree-error"
      >
        <p className="text-caption text-ink-tertiary">{t('terminals.sftp.loadError')}</p>
        <p className="max-w-full truncate text-caption text-ink-tertiary/80" title={error}>
          {error}
        </p>
        <button
          type="button"
          className="mt-1 rounded-md px-2 py-1 text-meta text-ink-secondary hover:bg-state-hover"
          onClick={reload}
        >
          {t('terminals.sftp.retry')}
        </button>
      </div>
    )
  }

  const rootLabel = rootPath ? basename(rootPath) : t('terminals.sftp.loading')
  const rootMenuPath = rootPath ?? startPath
  const rootMenuName = rootPath ? basename(rootPath) : startPath

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="sftp-file-tree">
      <div className="flex h-7 shrink-0 items-center justify-between gap-1 border-b border-border/80 px-1">
        <DeclarativeContextMenu
          kind="sftpEntry"
          payload={{
            terminalId,
            path: rootMenuPath,
            name: rootMenuName,
            isDir: true,
          }}
          className="min-w-0 flex-1"
        >
          <span
            className="block min-w-0 flex-1 cursor-default truncate rounded px-1 py-0.5 text-caption font-medium text-ink-tertiary hover:bg-state-hover"
            title={rootPath ?? startPath}
            data-testid="sftp-tree-root"
          >
            {rootLabel}
          </span>
        </DeclarativeContextMenu>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            title={t('terminals.sftp.uploadHere')}
            data-testid="sftp-upload-root"
            disabled={!rootPath}
            onClick={() => {
              if (!rootPath) return
              void runSftpUploadIntoDir(terminalId, rootPath, t)
            }}
            className="rounded-md p-1 text-ink-tertiary transition-colors hover:bg-state-hover hover:text-ink disabled:opacity-40"
          >
            <Upload size={12} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            title={t('terminals.sftp.refresh')}
            data-testid="sftp-refresh"
            onClick={reload}
            disabled={loadingRoot}
            className="rounded-md p-1 text-ink-tertiary transition-colors hover:bg-state-hover hover:text-ink disabled:opacity-50"
          >
            <RefreshCw size={12} strokeWidth={1.75} className={loadingRoot ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-0.5">
        {rootEntries?.map((e) => (
          <Node key={e.path} entry={e} terminalId={terminalId} depth={0} />
        ))}
        {!rootEntries && loadingRoot ? (
          <p className="px-2 py-2 text-caption text-ink-tertiary">{t('terminals.sftp.loading')}</p>
        ) : null}
        {rootEntries && rootEntries.length === 0 && !loadingRoot ? (
          <p className="px-2 py-2 text-caption text-ink-tertiary" data-testid="sftp-tree-empty">
            {t('terminals.sftp.emptyDir')}
          </p>
        ) : null}
      </div>
    </div>
  )
}
