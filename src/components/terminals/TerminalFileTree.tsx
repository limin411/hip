import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Folder,
  RefreshCw,
  Upload,
  ArrowUp,
  MapPin,
  ChevronRight,
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

function getParentPath(path: string): string {
  if (!path || path === '/') return '/'
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash <= 0) return '/'
  return normalized.slice(0, lastSlash) || '/'
}

/** 单个文件/目录行 */
function FileEntryRow({
  entry,
  onNavigate,
  terminalId,
  rootCwd,
}: {
  entry: SftpEntry
  onNavigate: (path: string) => void
  terminalId: string
  rootCwd?: string
}) {
  const fileIcon = fileIconForName(entry.name)
  const backend: TerminalFileTreeBackend = rootCwd !== undefined ? 'local' : 'sftp'

  const handleClick = () => {
    if (entry.isDir) {
      // 点击目录 -> 进入该目录
      onNavigate(entry.path)
    }
  }

  const row = (
    <div
      data-testid={backend === 'local' ? 'term-fs-entry' : 'sftp-entry'}
      data-path={entry.path}
      data-dir={entry.isDir ? '1' : '0'}
      onClick={handleClick}
      className={cn(
        'flex cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2 text-body transition-colors duration-chrome',
        'text-ink hover:bg-state-hover',
      )}
    >
      {entry.isDir ? (
        <Folder
          size={15}
          strokeWidth={1.75}
          className="shrink-0 text-amber-600/80 dark:text-amber-400/90"
        />
      ) : (
        <fileIcon.Icon
          size={15}
          strokeWidth={1.75}
          className={cn('shrink-0', fileIcon.className)}
          data-testid="term-file-type-icon"
          data-file-name={entry.name}
        />
      )}
      <span className="truncate flex-1" title={entry.path}>
        {entry.name}
      </span>
      {entry.isDir && (
        <ChevronRight size={13} strokeWidth={1.75} className="shrink-0 text-ink-tertiary" />
      )}
    </div>
  )

  // 包装右键菜单
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
        {row}
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
      {row}
    </DeclarativeContextMenu>
  )
}

export function TerminalFileTree({
  terminalId,
  initialPath,
  backend = 'sftp',
}: {
  terminalId: string
  initialPath?: string
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

  const ptyStatus = useTerminalStore((s) => s.bySession[terminalId]?.status ?? 'idle')
  const sftpConnecting = backend === 'sftp' && (ptyStatus === 'idle' || ptyStatus === 'starting')
  const sftpReady = backend !== 'sftp' || ptyStatus === 'running'

  const startPath = backend === 'local' ? '.' : initialPath?.trim() || '.'

  const load = useCallback(
    (path: string) => {
      if (backend === 'local') void loadLocalDir(terminalId, path || '.')
      else void loadSftpDir(terminalId, path)
    },
    [backend, terminalId],
  )

  const reload = useCallback(() => {
    load(rootPath ?? startPath)
  }, [load, rootPath, startPath])

  // 导航到指定目录
  const navigateTo = useCallback(
    async (path: string) => {
      const store = useTerminalFsStore.getState()
      const oldPath = store.byTerminal[terminalId]?.rootPath ?? null

      // 更新 rootPath
      store.setRootPath(terminalId, path)

      try {
        // 加载目录
        if (backend === 'local') {
          await loadLocalDir(terminalId, path || '.')
        } else {
          await loadSftpDir(terminalId, path)
        }

        // 检查加载是否成功
        const freshState = useTerminalFsStore.getState()
        const slice = freshState.byTerminal[terminalId]
        const entries = slice?.entriesByDir[path]
        const hasEntries = entries && entries.length > 0

        if (!hasEntries) {
          const currentError = slice?.error
          const currentDirError = slice?.dirErrors?.[path]
          if ((currentError || currentDirError) && oldPath) {
            freshState.setRootPath(terminalId, oldPath)
          }
        }
      } catch (e) {
        if (oldPath) {
          useTerminalFsStore.getState().setRootPath(terminalId, oldPath)
        }
      }
    },
    [terminalId, backend],
  )

  // 返回上一级
  const navigateToParent = useCallback(() => {
    if (!rootPath || rootPath === '/') return
    const parentPath = getParentPath(rootPath)
    void navigateTo(parentPath)
  }, [rootPath, navigateTo])

  const [isPathInputActive, setIsPathInputActive] = useState(false)

  // 键盘快捷键：Alt+↑ 返回上一级，Ctrl+L 切换路径输入
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'ArrowUp') {
        e.preventDefault()
        navigateToParent()
      } else if (e.ctrlKey && e.key === 'l') {
        e.preventDefault()
        setIsPathInputActive((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [navigateToParent])

  // 初始加载
  useEffect(() => {
    if (!sftpReady) return
    if (!rootPath && !rootEntries) {
      if (
        backend === 'sftp' &&
        useTerminalFsStore.getState().getSlice(terminalId).error === 'session_closed'
      ) {
        useTerminalFsStore.getState().setError(terminalId, null)
      }
      load(startPath)
    }
  }, [terminalId, startPath, rootPath, rootEntries, load, sftpReady, backend])

  // SSH 会话关闭状态
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

  // 错误状态
  if (
    error &&
    !rootEntries &&
    !(backend === 'sftp' && error === 'session_closed' && sftpConnecting)
  ) {
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
  const treeTestId = backend === 'local' ? 'term-fs-file-tree' : 'sftp-file-tree'
  const emptyTestId = backend === 'local' ? 'term-fs-tree-empty' : 'sftp-tree-empty'
  const refreshTestId = backend === 'local' ? 'term-fs-refresh' : 'sftp-refresh'
  const labelRootCwd = rootPath ?? initialPath ?? ''

  // 判断是否可以返回上一级
  const canGoUp = rootPath && rootPath !== '/'

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid={treeTestId}>
      {/* 工具栏 */}
      <div className="flex h-8 shrink-0 items-center justify-between gap-1 border-b border-border/80 px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {/* 返回上一级按钮 */}
          <button
            type="button"
            title={t('terminals.navigation.up') + ' (Alt+↑)'}
            data-testid="navigation-up"
            onClick={navigateToParent}
            disabled={!canGoUp}
            className="rounded-md p-1 text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink disabled:opacity-30"
          >
            <ArrowUp size={13} strokeWidth={1.75} />
          </button>

          {/* 当前路径 */}
          <span
            className="truncate flex-1 text-caption font-medium text-ink-secondary"
            title={rootPath ?? ''}
            data-testid="current-path"
          >
            {rootLabel}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {/* 路径输入按钮 */}
          <button
            type="button"
            title={t('terminals.navigation.pathInput') + ' (Ctrl+L)'}
            data-testid="navigation-path-input"
            onClick={() => setIsPathInputActive((prev) => !prev)}
            className={cn(
              'rounded-md p-1 text-ink-tertiary transition-colors duration-chrome hover:bg-state-hover hover:text-ink',
              isPathInputActive && 'bg-state-hover text-ink',
            )}
          >
            <MapPin size={13} strokeWidth={1.75} />
          </button>

          {/* 上传按钮（仅 SFTP） */}
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

          {/* 刷新按钮 */}
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

      {/* 面包屑导航 */}
      <TerminalBreadcrumb
        terminalId={terminalId}
        currentPath={rootPath}
        backend={backend}
        onNavigate={navigateTo}
      />

      {/* 路径输入框（条件渲染） */}
      {isPathInputActive && (
        <PathInput
          terminalId={terminalId}
          currentPath={rootPath}
          backend={backend}
          onNavigate={navigateTo}
          onCancel={() => setIsPathInputActive(false)}
        />
      )}

      {/* 文件列表 */}
      <div className="min-h-0 flex-1 overflow-auto py-0.5 px-1">
        {/* 当前目录的文件/文件夹列表 */}
        {rootEntries?.map((entry) => (
          <FileEntryRow
            key={entry.path}
            entry={entry}
            onNavigate={navigateTo}
            terminalId={terminalId}
            rootCwd={backend === 'local' ? labelRootCwd : undefined}
          />
        ))}

        {/* 加载中 */}
        {!rootEntries && (loadingRoot || sftpConnecting) ? (
          <p
            className="px-2 py-2 text-caption text-ink-tertiary"
            data-testid={backend === 'sftp' ? 'sftp-tree-loading' : 'term-fs-tree-loading'}
          >
            {backend === 'local' ? t('terminals.localFs.loading') : t('terminals.sftp.loading')}
          </p>
        ) : null}

        {/* 空目录 */}
        {rootEntries && rootEntries.length === 0 && !loadingRoot ? (
          <p className="px-2 py-2 text-caption text-ink-tertiary" data-testid={emptyTestId}>
            {backend === 'local' ? t('terminals.localFs.emptyDir') : t('terminals.sftp.emptyDir')}
          </p>
        ) : null}
      </div>
    </div>
  )
}
