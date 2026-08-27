import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  RefreshCw,
  Upload,
  ArrowUp,
  ArrowLeft,
  ArrowRight,
  MapPin,
} from 'lucide-react'
import type { SftpEntry } from '@/ipc/sftp'
import { useTerminalFsStore } from '@/store/terminalFsStore'
import { useTerminalStore } from '@/store/terminalStore'
import { DeclarativeContextMenu } from '@/components/context-menu'
import {
  loadSftpDir,
  refreshSftpDir,
  runSftpUploadIntoDir,
} from '@/components/terminals/sftpActions'
import { loadLocalDir, refreshLocalDir } from '@/components/terminals/termFsActions'
import { fileIconForName } from '@/lib/fileIcon'
import { cn } from '@/lib/utils'
import { TerminalBreadcrumb } from './TerminalBreadcrumb'
import { PathInput } from './PathInput'

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
  const fileIcon = fileIconForName(entry.name)
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
          <FolderOpen
            size={15}
            strokeWidth={1.75}
            className="shrink-0 text-amber-600/80 dark:text-amber-400/90"
          />
        ) : (
          <Folder
            size={15}
            strokeWidth={1.75}
            className="shrink-0 text-amber-600/80 dark:text-amber-400/90"
          />
        )
      ) : (
        <fileIcon.Icon
          size={15}
          strokeWidth={1.75}
          className={cn('shrink-0', fileIcon.className)}
          data-testid="term-file-type-icon"
          data-file-name={entry.name}
        />
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
          className="truncate px-2 py-0.5 text-caption text-danger/90"
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
  // Navigation history state
  const canGoBack = useTerminalFsStore((s) => s.canGoBack(terminalId))
  const canGoForward = useTerminalFsStore((s) => s.canGoForward(terminalId))
  // SSH files rail mounts as soon as the tab is focused; ssh_open happens later in
  // XtermSurface. Gate listing on status=running so we never treat "not open yet"
  // as a permanent session_closed (Rust uses the same string for missing sessions).
  const ptyStatus = useTerminalStore((s) => s.bySession[terminalId]?.status ?? 'idle')
  const sftpConnecting =
    backend === 'sftp' && (ptyStatus === 'idle' || ptyStatus === 'starting')
  const sftpReady = backend !== 'sftp' || ptyStatus === 'running'

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

  // Navigation functions
  const navigateTo = useCallback(async (path: string) => {
    const store = useTerminalFsStore.getState()
    const oldPath = store.byTerminal[terminalId]?.rootPath ?? null
    
    // Update rootPath immediately for UI feedback
    store.setRootPath(terminalId, path)
    store.pushNavigation(terminalId, path)
    
    try {
      // Try to load the directory
      if (backend === 'local') {
        await loadLocalDir(terminalId, path || '.')
      } else {
        await loadSftpDir(terminalId, path)
      }
      
      // After loading, get fresh state to check results
      const freshState = useTerminalFsStore.getState()
      const slice = freshState.byTerminal[terminalId]
      
      // Check if loading succeeded by looking at entries
      const entries = slice?.entriesByDir[path]
      const hasEntries = entries && entries.length > 0
      
      // If no entries were loaded, check for errors
      if (!hasEntries) {
        const currentError = slice?.error
        const currentDirError = slice?.dirErrors?.[path]
        
        // If there's an error, navigation failed - restore old path
        if (currentError || currentDirError) {
          if (oldPath) {
            freshState.setRootPath(terminalId, oldPath)
          }
        }
      }
    } catch (e) {
      // Navigation failed, restore old path
      if (oldPath) {
        useTerminalFsStore.getState().setRootPath(terminalId, oldPath)
      }
    }
  }, [terminalId, backend])

  const navigateToParent = useCallback(() => {
    if (!rootPath || rootPath === '/') return
    const normalized = rootPath.replace(/\\/g, '/').replace(/\/+$/, '')
    const lastSlash = normalized.lastIndexOf('/')
    if (lastSlash <= 0) return
    const parentPath = normalized.slice(0, lastSlash) || '/'
    void navigateTo(parentPath)
  }, [rootPath, navigateTo])

  const goBack = useCallback(() => {
    const path = useTerminalFsStore.getState().goBack(terminalId)
    if (path) {
      void navigateTo(path)
    }
  }, [terminalId, navigateTo])

  const goForward = useCallback(() => {
    const path = useTerminalFsStore.getState().goForward(terminalId)
    if (path) {
      void navigateTo(path)
    }
  }, [terminalId, navigateTo])

  const [isPathInputActive, setIsPathInputActive] = useState(false)

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'ArrowUp') {
        e.preventDefault()
        navigateToParent()
      } else if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault()
        goBack()
      } else if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault()
        goForward()
      } else if (e.ctrlKey && e.key === 'l') {
        e.preventDefault()
        setIsPathInputActive(prev => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [navigateToParent, goBack, goForward])

  useEffect(() => {
    if (!sftpReady) return
    if (!rootPath && !rootEntries) {
      // Drop a stale pre-connect "session_closed" so the tree can recover without
      // closing/reopening the right panel.
      if (
        backend === 'sftp' &&
        useTerminalFsStore.getState().getSlice(terminalId).error === 'session_closed'
      ) {
        useTerminalFsStore.getState().setError(terminalId, null)
      }
      load(startPath)
      // Push initial path to navigation history
      useTerminalFsStore.getState().pushNavigation(terminalId, startPath)
    }
  }, [terminalId, startPath, rootPath, rootEntries, load, sftpReady, backend])

  // Only surface permanent closed after connect finished (or session died). While
  // idle/starting the same error means "not open yet" — show loading instead.
  if (backend === 'sftp' && error === 'session_closed' && !sftpConnecting) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center text-caption text-ink-tertiary"
        data-testid="sftp-session-closed"
      >
        {t('terminals.sftp.sessionClosed')}
        {ptyStatus === 'running' ? (
          <button
            type="button"
            className="mt-1 rounded-md px-2 py-1 text-meta text-ink-secondary hover:bg-state-hover"
            onClick={reload}
            data-testid="sftp-session-closed-retry"
          >
            {t('terminals.sftp.retry')}
          </button>
        ) : null}
      </div>
    )
  }

  // While SSH is still opening, suppress generic error chrome for a stale
  // session_closed so the loading state can show instead.
  if (error && !rootEntries && !(backend === 'sftp' && error === 'session_closed' && sftpConnecting)) {
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
  // path / "username" strip lines up with the left terminal toolbar across the split.
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
          {/* Navigation buttons */}
          <button
            type="button"
            title={t('terminals.navigation.up') + ' (Alt+↑)'}
            data-testid="navigation-up"
            onClick={navigateToParent}
            disabled={!rootPath || rootPath === '/'}
            className="rounded-md p-1 text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink disabled:opacity-50"
          >
            <ArrowUp size={13} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            title={t('terminals.navigation.back') + ' (Alt+←)'}
            data-testid="navigation-back"
            onClick={goBack}
            disabled={!canGoBack}
            className="rounded-md p-1 text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink disabled:opacity-50"
          >
            <ArrowLeft size={13} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            title={t('terminals.navigation.forward') + ' (Alt+→)'}
            data-testid="navigation-forward"
            onClick={goForward}
            disabled={!canGoForward}
            className="rounded-md p-1 text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink disabled:opacity-50"
          >
            <ArrowRight size={13} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            title={t('terminals.navigation.pathInput') + ' (Ctrl+L)'}
            data-testid="navigation-path-input"
            onClick={() => setIsPathInputActive(prev => !prev)}
            className={cn(
              'rounded-md p-1 text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink',
              isPathInputActive && 'bg-state-hover text-ink'
            )}
          >
            <MapPin size={13} strokeWidth={1.75} />
          </button>
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
            disabled={loadingRoot || sftpConnecting}
            className="rounded-md p-1 text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink disabled:opacity-50"
          >
            <RefreshCw
              size={13}
              strokeWidth={1.75}
              className={loadingRoot || sftpConnecting ? 'animate-spin' : ''}
            />
          </button>
        </div>
      </div>
      {/* Breadcrumb navigation */}
      <TerminalBreadcrumb
        terminalId={terminalId}
        currentPath={rootPath}
        backend={backend}
        onNavigate={navigateTo}
      />
      {/* Path input (conditional) */}
      {isPathInputActive && (
        <PathInput
          terminalId={terminalId}
          currentPath={rootPath}
          backend={backend}
          onNavigate={navigateTo}
          onCancel={() => setIsPathInputActive(false)}
        />
      )}
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
        {!rootEntries && (loadingRoot || sftpConnecting) ? (
          <p
            className="px-2 py-2 text-caption text-ink-tertiary"
            data-testid={backend === 'sftp' ? 'sftp-tree-loading' : 'term-fs-tree-loading'}
          >
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
