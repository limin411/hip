import { useCallback, useState } from 'react'
import { Folder, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useActiveSession, useActiveSessionId, sessionService } from '@/domain'
import { pickDirectory } from '@/ipc/dialog'
import { ptyKill, ptyOpen, ptyResize, ptyWrite } from '@/ipc/pty'
import { useTerminalStore } from '@/store/terminalStore'
import { DeclarativeContextMenu } from '@/components/context-menu'
import { Button } from '@/components/ui/Button'
import { XtermSurface } from './XtermSurface'

/**
 * Code-panel Terminal tab: domain session + cwd chrome around shared XtermSurface.
 * Live output: store subscription only (D6a single-writer). Bridge never touches Terminal.
 * xterm is lazy-loaded inside XtermSurface to keep the main chat bundle smaller.
 */
export function TerminalView() {
  const { t } = useTranslation()
  const sessionId = useActiveSessionId()
  const cwd = useActiveSession()?.config.cwd
  const status = useTerminalStore((s) =>
    sessionId ? s.bySession[sessionId]?.status ?? 'idle' : 'idle',
  )

  const [bootKey, setBootKey] = useState(0)

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
    setBootKey((k) => k + 1)
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
        payload={{ sessionId, status }}
        className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border/80 px-2.5"
        data-testid="terminal-chrome"
      >
        <div className="flex min-w-0 flex-1 items-center justify-between gap-2" data-tauri-drag-region="false">
          <span
            className="min-w-0 truncate font-mono text-meta text-ink-tertiary"
            title={cwd}
            data-testid="terminal-cwd"
          >
            {cwd}
          </span>
          <button
            type="button"
            data-testid="terminal-restart"
            onClick={() => void restart()}
            title={t('artifact.terminalView.restart')}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-meta font-medium text-ink-secondary transition-colors hover:bg-surface-muted hover:text-ink"
          >
            <RotateCcw size={13} />
            {t('artifact.terminalView.restart')}
          </button>
        </div>
      </DeclarativeContextMenu>

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
    </div>
  )
}
