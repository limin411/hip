import { useCallback, useEffect, type ReactNode } from 'react'
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
import { loadLocalDir, refreshLocalDir } from '@/components/terminals/termFsActions'
import { cn } from '@/lib/utils'

export { refreshSftpDir, refreshLocalDir }

export type TerminalFileTreeBackend = 'sftp' | 'local'

function basename(p: string): string {
  if (!p) return ''
  const parts = p.replace(/\/+$/, '').split(/[/\\]/)
  return parts[parts.length - 1] || p
}

/** Shared row chrome for local + SFTP tree entries. */
function EntryRow({
  entry,
  depth,
  open,
  loading,
  testId,
  onClick,
}: {
  entry: SftpEntry
  depth: number
  open: boolean
  loading: boolean
  testId: string
  onClick: () => void
}) {
  return (
    <div
      data-testid={testId}
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
      {loading ? <span className="ml-auto text-caption text-ink-tertiary">…</span> : null}
    </div>
  )
}

function withEntryMenu(
  backend: TerminalFileTreeBackend,
  terminalId: string,
  entry: SftpEntry,
  rootCwd: string | undefined,
  children: ReactNode,
) {
  if (backend === 'local') {
    return (
      <DeclarativeContextMenu
        kind="termFsEntry"
        payload={{
          terminalId,
          path: entry.path,
          name: entry.name,
          isDir: entry.isDir,
          rootCwd: rootCwd ?? '',
        }}
      >
        {children}
      </DeclarativeContextMenu>
    )
  }
  return (
    <DeclarativeContextMenu
      kind="sftpEntry"
      payload={{
        terminalId,
        path: entry.path,
        name: entry.name,
        isDir: entry.isDir,
      }}
    >
      {children}
    </DeclarativeContextMenu>
  )
}

function Node({
  entry,
  terminalId,
  depth,
  backend,
  rootCwd,
}: {
  entry: SftpEntry
  terminalId: string
  depth: number
  backend: TerminalFileTreeBackend
  rootCwd?: string
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
      if (backend === 'local') void loadLocalDir(terminalId, entry.path)
      else void loadSftpDir(terminalId, entry.path)
    }
  }

  const row = (
    <EntryRow
      entry={entry}
      depth={depth}
      open={open}
      loading={loading}
      testId={backend === 'local' ? 'term-fs-tree-entry' : 'sftp-tree-entry'}
      onClick={onClick}
    />
  )

  return (
    <div>
      {withEntryMenu(backend, terminalId, entry, rootCwd, row)}
      {entry.isDir && open && dirError ? (
        <p
          className="truncate px-2 py-0.5 text-caption text-red-500/90"
          style={{ paddingLeft: (depth + 1) * 12 + 4 }}
          data-testid={backend === 'local' ? 'term-fs-dir-error' : 'sftp-dir-error'}
          title={dirError}
        >
          {dirError}
        </p>
      ) : null}
      {entry.isDir &&
        open &&
        children?.map((c) => (
          <Node
            key={c.path}
            entry={c}
            terminalId={terminalId}
            depth={depth + 1}
            backend={backend}
            rootCwd={rootCwd}
          />
        ))}
    </div>
  )
}

export function TerminalFileTree({
  terminalId,
  initialPath,
  backend = 'sftp',
}: {
  terminalId: string
  /**
   * SFTP: host remotePath or empty (home / `.`).
   * Local: launch cwd for labels / open-folder only — listing always uses `.`
   * so absolute non-canon paths never hit the jail before realpath.
   */
  initialPath?: string
  /** SFTP remote tree vs local launch-cwd tree. */
  backend?: TerminalFileTreeBackend
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

  // Local: always list with "." (session root). Absolute initialPath is label/rootCwd only.
  // SFTP: empty → "." (server home); else host remotePath.
  const startPath = backend === 'local' ? '.' : initialPath?.trim() || '.'

  const load = useCallback(
    (path: string) => {
      if (backend === 'local') void loadLocalDir(terminalId, path || '.')
      else void loadSftpDir(terminalId, path)
    },
    [backend, terminalId],
  )

  const reload = useCallback(() => {
    // Prefer resolved root; local falls back to "." not absolute launch cwd.
    load(rootPath ?? startPath)
  }, [load, rootPath, startPath])

  useEffect(() => {
    if (!rootPath && !rootEntries) {
      load(startPath)
    }
  }, [terminalId, startPath, rootPath, rootEntries, load])

  if (backend === 'sftp' && error === 'session_closed') {
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
        data-testid={backend === 'local' ? 'term-fs-tree-error' : 'sftp-tree-error'}
      >
        <p className="text-caption text-ink-tertiary">
          {backend === 'local' ? t('terminals.localFs.loadError') : t('terminals.sftp.loadError')}
        </p>
        <p className="max-w-full truncate text-caption text-ink-tertiary/80" title={error}>
          {error}
        </p>
        <button
          type="button"
          className="mt-1 rounded-md px-2 py-1 text-meta text-ink-secondary hover:bg-state-hover"
          onClick={reload}
        >
          {backend === 'local' ? t('terminals.localFs.retry') : t('terminals.sftp.retry')}
        </button>
      </div>
    )
  }

  const rootLabel = rootPath
    ? basename(rootPath)
    : backend === 'local'
      ? t('terminals.localFs.launchDir')
      : t('terminals.sftp.loading')
  // Menu path: resolved root when known; local still uses "." until first ls (not absolute cwd).
  const rootMenuPath = rootPath ?? startPath
  const rootMenuName = rootPath ? basename(rootPath) : startPath
  const treeTestId = backend === 'local' ? 'term-fs-file-tree' : 'sftp-file-tree'
  const rootTestId = backend === 'local' ? 'term-fs-tree-root' : 'sftp-tree-root'
  const emptyTestId = backend === 'local' ? 'term-fs-tree-empty' : 'sftp-tree-empty'
  const refreshTestId = backend === 'local' ? 'term-fs-refresh' : 'sftp-refresh'
  const labelRootCwd = rootPath ?? initialPath ?? ''

  const rootTitle =
    backend === 'local'
      ? rootPath
        ? `${t('terminals.localFs.launchDir')}: ${rootPath}`
        : initialPath ?? startPath
      : (rootPath ?? startPath)

  // Match FileTree root row + ManagedTerminalSession chrome (h-8, px-2) so the
  // path / “username” strip lines up with the left terminal toolbar across the split.
  const rootHeader = (
    <span
      className="flex min-w-0 flex-1 cursor-default items-center gap-1.5 truncate rounded px-0.5 text-caption font-medium text-ink-tertiary hover:bg-state-hover"
      title={rootTitle}
      data-testid={rootTestId}
    >
      <Folder size={13} strokeWidth={1.75} className="shrink-0" aria-hidden />
      <span className="truncate text-ink-secondary">{rootLabel}</span>
    </span>
  )

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid={treeTestId}>
      <div className="flex h-8 shrink-0 items-center justify-between gap-1 border-b border-border/80 px-2">
        {backend === 'local' ? (
          <DeclarativeContextMenu
            kind="termFsEntry"
            payload={{
              terminalId,
              path: rootMenuPath,
              name: rootMenuName,
              isDir: true,
              rootCwd: labelRootCwd,
            }}
            className="min-w-0 flex-1"
          >
            {rootHeader}
          </DeclarativeContextMenu>
        ) : (
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
            {rootHeader}
          </DeclarativeContextMenu>
        )}
        <div className="flex shrink-0 items-center gap-0.5">
          {backend === 'sftp' ? (
            <button
              type="button"
              title={t('terminals.sftp.uploadHere')}
              data-testid="sftp-upload-root"
              disabled={!rootPath}
              onClick={() => {
                if (!rootPath) return
                void runSftpUploadIntoDir(terminalId, rootPath, t)
              }}
              className="rounded-md p-1 text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink disabled:opacity-40"
            >
              <Upload size={13} strokeWidth={1.75} />
            </button>
          ) : null}
          <button
            type="button"
            title={
              backend === 'local' ? t('terminals.localFs.refresh') : t('terminals.sftp.refresh')
            }
            data-testid={refreshTestId}
            onClick={reload}
            disabled={loadingRoot}
            className="rounded-md p-1 text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink disabled:opacity-50"
          >
            <RefreshCw size={13} strokeWidth={1.75} className={loadingRoot ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-0.5">
        {rootEntries?.map((e) => (
          <Node
            key={e.path}
            entry={e}
            terminalId={terminalId}
            depth={0}
            backend={backend}
            rootCwd={labelRootCwd}
          />
        ))}
        {!rootEntries && loadingRoot ? (
          <p className="px-2 py-2 text-caption text-ink-tertiary">
            {backend === 'local' ? t('terminals.localFs.loading') : t('terminals.sftp.loading')}
          </p>
        ) : null}
        {rootEntries && rootEntries.length === 0 && !loadingRoot ? (
          <p className="px-2 py-2 text-caption text-ink-tertiary" data-testid={emptyTestId}>
            {backend === 'local' ? t('terminals.localFs.emptyDir') : t('terminals.sftp.emptyDir')}
          </p>
        ) : null}
      </div>
    </div>
  )
}
