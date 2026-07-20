import { useCallback, useState } from 'react'
import { RotateCcw, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ptyKill, ptyOpen, ptyResize, ptyWrite } from '@/ipc/pty'
import {
  recordSuccessfulLocalLaunch,
  useManagedTerminalStore,
} from '@/store/managedTerminalStore'
import { useTerminalStore } from '@/store/terminalStore'
import { DeclarativeContextMenu } from '@/components/context-menu'
import { XtermSurface } from '@/components/artifact/XtermSurface'
import { cn } from '@/lib/utils'

/**
 * Focused managed terminal workspace: chrome + shared XtermSurface (PTY backend).
 * Unmount detaches xterm but does not kill PTY (D6a keep-alive).
 */
export function ManagedTerminalSession({ terminalId }: { terminalId: string }) {
  const { t } = useTranslation()
  const term = useManagedTerminalStore((s) => s.terminals.find((x) => x.id === terminalId))
  const [bootKey, setBootKey] = useState(0)

  const cwd = term?.cwd
  const kind = term?.kind ?? 'local'

  const restart = useCallback(async () => {
    try {
      await ptyKill(terminalId)
    } catch {
      /* already dead */
    }
    useTerminalStore.getState().clearSession(terminalId)
    useTerminalStore.getState().ensureSession(terminalId)
    setBootKey((k) => k + 1)
  }, [terminalId])

  const close = useCallback(() => {
    void useManagedTerminalStore.getState().close(terminalId)
  }, [terminalId])

  if (!term) {
    return (
      <div
        className="flex h-full items-center justify-center text-meta text-ink-tertiary"
        data-testid="managed-terminal-missing"
      >
        {t('terminals.sessionMissing')}
      </div>
    )
  }

  if (kind === 'ssh') {
    // SSH lands in PR5 — keep a stub so list can hold ssh rows later.
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-ink-secondary"
        data-testid="managed-terminal-ssh-stub"
      >
        <p className="text-body font-medium text-ink">{term.title}</p>
        <p className="text-meta">{t('terminals.sshComingSoon')}</p>
      </div>
    )
  }

  if (!cwd) {
    return (
      <div
        className="flex h-full items-center justify-center text-meta text-ink-tertiary"
        data-testid="managed-terminal-no-cwd"
      >
        {t('terminals.noCwd')}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface" data-testid="managed-terminal-session">
      <DeclarativeContextMenu
        kind="managedTerminal"
        payload={{ terminalId, kind: 'local', title: term.title }}
        className="flex min-h-8 shrink-0 items-center justify-between gap-2 border-b border-border/80 px-2.5 py-1"
        data-testid="managed-terminal-chrome"
      >
        <div
          className="flex min-w-0 flex-1 items-center justify-between gap-2"
          data-tauri-drag-region="false"
        >
          {/* Single-line chrome (match code-panel density): title visible, cwd in tooltip. */}
          <span
            className="min-w-0 flex-1 truncate font-mono text-meta text-ink-tertiary"
            title={`${term.title} — ${cwd}`}
            data-testid="managed-terminal-title"
            data-cwd={cwd}
          >
            <span className="font-sans font-medium text-ink">{term.title}</span>
            <span className="mx-1.5 text-ink-tertiary/60" aria-hidden>
              ·
            </span>
            <span data-testid="managed-terminal-cwd">{cwd}</span>
          </span>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              data-testid="managed-terminal-restart"
              onClick={() => void restart()}
              title={t('artifact.terminalView.restart')}
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2 py-1 text-meta font-medium',
                'text-ink-secondary transition-colors hover:bg-surface-muted hover:text-ink',
              )}
            >
              <RotateCcw size={13} />
              {t('artifact.terminalView.restart')}
            </button>
            <button
              type="button"
              data-testid="managed-terminal-close"
              onClick={close}
              title={t('terminals.close')}
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2 py-1 text-meta font-medium',
                'text-ink-secondary transition-colors hover:bg-surface-muted hover:text-ink',
              )}
            >
              <X size={13} />
              {t('terminals.close')}
            </button>
          </div>
        </div>
      </DeclarativeContextMenu>

      <XtermSurface
        key={bootKey}
        terminalId={terminalId}
        backend="pty"
        cwd={cwd}
        open={async (cols, rows) => {
          const result = await ptyOpen(terminalId, cwd, cols, rows)
          // K11: only true new launches push recents — skip keep-alive remounts (reused).
          if (!result.reused) {
            try {
              await recordSuccessfulLocalLaunch(cwd, term.title)
            } catch {
              /* catalog write failure must not break the shell */
            }
          }
          return result
        }}
        write={(data) => ptyWrite(terminalId, data)}
        resize={(cols, rows) => ptyResize(terminalId, cols, rows)}
        onRestart={restart}
      />
    </div>
  )
}
