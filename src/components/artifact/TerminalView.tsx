import { useCallback, useEffect, useState } from 'react'
import { Folder, RotateCcw, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useActiveSession, useActiveSessionId, sessionService } from '@/domain'
import { pickDirectory } from '@/ipc/dialog'
import { ptyKill, ptyOpen, ptyResize, ptyWrite } from '@/ipc/pty'
import { useTerminalStore } from '@/store/terminalStore'
import { DeclarativeContextMenu } from '@/components/context-menu'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { XtermSurface } from './XtermSurface'

/**
 * Code-panel Terminal tab: domain session + cwd chrome around shared XtermSurface.
 * Live output: store subscription only (D6a single-writer). Bridge never touches Terminal.
 * xterm is lazy-loaded inside XtermSurface to keep the main chat bundle smaller.
 *
 * Chrome mirrors ManagedTerminalSession: Restart + Close.
 * Close kills the PTY and clears the ring without auto-reopen (frees soft-cap slots).
 * Restart after close re-opens a fresh shell.
 */
export function TerminalView() {
  const { t } = useTranslation()
  const sessionId = useActiveSessionId()
  const cwd = useActiveSession()?.config.cwd
  const status = useTerminalStore((s) =>
    sessionId ? s.bySession[sessionId]?.status ?? 'idle' : 'idle',
  )

  const [bootKey, setBootKey] = useState(0)
  /** Explicit user close — unmount surface so we do not keep-alive / re-open. */
  const [closed, setClosed] = useState(false)

  useEffect(() => {
    setClosed(false)
  }, [sessionId])

  const chooseFolder = useCallback(async () => {
    if (!sessionId) return
    const dir = await pickDirectory()
    if (!dir) return
    sessionService.setProjectDir(sessionId, dir)
  }, [sessionId])

  const restart = useCallback(async () => {
    if (!sessionId) return
    try {
      await ptyKill(sessionId)
    } catch {
      /* ok if already dead */
    }
    useTerminalStore.getState().clearSession(sessionId)
    setClosed(false)
    setBootKey((k) => k + 1)
  }, [sessionId])

  const close = useCallback(async () => {
    if (!sessionId) return
    try {
      await ptyKill(sessionId)
    } catch {
      /* ok if already dead */
    }
    useTerminalStore.getState().clearSession(sessionId)
    setClosed(true)
  }, [sessionId])

  if (!sessionId) return null

  if (!cwd) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-ink-tertiary"
        data-testid="terminal-view-empty"
      >
        <Folder size={32} className="opacity-40" />
        <div className="max-w-[240px] text-body font-medium text-ink-secondary">
          {t('artifact.terminalView.noCwd')}
        </div>
        <div className="max-w-[240px] text-meta">{t('artifact.terminalView.noCwdDesc')}</div>
        <Button
          type="button"
          data-testid="terminal-select-folder"
          onClick={() => void chooseFolder()}
          variant="primary"
          size="sm"
        >
          {t('artifact.terminalView.selectFolder')}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface" data-testid="terminal-view">
      <DeclarativeContextMenu
        kind="terminal"
        payload={{ sessionId, status: closed ? 'idle' : status }}
        className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border/80 px-2.5"
        data-testid="terminal-chrome"
      >
        <div
          className="flex min-w-0 flex-1 items-center justify-between gap-2"
          data-tauri-drag-region="false"
        >
          <span
            className="min-w-0 truncate font-mono text-meta text-ink-tertiary"
            title={cwd}
            data-testid="terminal-cwd"
          >
            {cwd}
          </span>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              data-testid="terminal-restart"
              onClick={() => void restart()}
              title={t('artifact.terminalView.restart')}
              className={cn(
                'inline-flex items-center gap-1 rounded-sm px-2 py-1 text-meta font-medium',
                'text-ink-secondary transition-colors hover:bg-state-hover hover:text-ink',
              )}
            >
              <RotateCcw size={13} />
              {t('artifact.terminalView.restart')}
            </button>
            <button
              type="button"
              data-testid="terminal-close"
              onClick={() => void close()}
              disabled={closed}
              title={t('artifact.terminalView.close')}
              className={cn(
                'inline-flex items-center gap-1 rounded-sm px-2 py-1 text-meta font-medium',
                'text-ink-secondary transition-colors hover:bg-state-hover hover:text-ink',
                'disabled:pointer-events-none disabled:opacity-40',
              )}
            >
              <X size={13} />
              {t('artifact.terminalView.close')}
            </button>
          </div>
        </div>
      </DeclarativeContextMenu>

      {closed ? (
        <div
          className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
          data-testid="terminal-view-closed"
        >
          <div className="text-body font-medium text-ink-secondary">
            {t('artifact.terminalView.closed')}
          </div>
          <div className="max-w-[260px] text-meta text-ink-tertiary">
            {t('artifact.terminalView.closedDesc')}
          </div>
          <Button
            type="button"
            data-testid="terminal-closed-restart"
            onClick={() => void restart()}
            variant="primary"
            size="sm"
          >
            <RotateCcw size={13} className="mr-1.5" />
            {t('artifact.terminalView.restart')}
          </Button>
        </div>
      ) : (
        <XtermSurface
          key={bootKey}
          terminalId={sessionId}
          backend="pty"
          cwd={cwd}
          open={(cols, rows) => ptyOpen(sessionId, cwd, cols, rows)}
          write={(data) => ptyWrite(sessionId, data)}
          resize={(cols, rows) => ptyResize(sessionId, cols, rows)}
          onRestart={restart}
        />
      )}
    </div>
  )
}
