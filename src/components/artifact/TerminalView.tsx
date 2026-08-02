import { Folder, Power, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ptyOpen, ptyResize, ptyWrite } from '@/ipc/pty'
import { DeclarativeContextMenu } from '@/components/context-menu'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { XtermSurface } from './XtermSurface'
import {
  CodeTerminalProvider,
  useCodeTerminalController,
  useCodeTerminalControllerOptional,
} from './codeTerminalController'

/**
 * Code-panel Terminal tab body.
 * When mounted under ArtifactPanel + CodeTerminalProvider, titlebar chrome
 * (cwd / restart / close) lives in PanelContextSlot — no second row here.
 * Standalone (tests / fallback) keeps a local chrome row.
 */
function TerminalViewBody({ showChrome }: { showChrome: boolean }) {
  const { t } = useTranslation()
  const { sessionId, cwd, status, closed, bootKey, restart, close, chooseFolder } =
    useCodeTerminalController()

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
      {showChrome && (
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
                <Power size={13} />
                {t('artifact.terminalView.close')}
              </button>
            </div>
          </div>
        </DeclarativeContextMenu>
      )}

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
        <DeclarativeContextMenu
          kind="terminal"
          payload={{ sessionId, status }}
          className="flex min-h-0 flex-1 flex-col"
        >
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
        </DeclarativeContextMenu>
      )}
    </div>
  )
}

export function TerminalView() {
  const existing = useCodeTerminalControllerOptional()
  if (existing) return <TerminalViewBody showChrome={false} />
  return (
    <CodeTerminalProvider>
      <TerminalViewBody showChrome />
    </CodeTerminalProvider>
  )
}
