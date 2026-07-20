import { useCallback, useState } from 'react'
import { RotateCcw, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ptyKill, ptyOpen, ptyResize, ptyWrite } from '@/ipc/pty'
import {
  parseSshInvokeError,
  sshClose,
  sshOpen,
  sshResize,
  sshWrite,
  type HostKeyMismatchError,
} from '@/ipc/ssh'
import {
  recordSuccessfulLocalLaunch,
  recordSuccessfulSshLaunch,
  useManagedTerminalStore,
} from '@/store/managedTerminalStore'
import { useTerminalHostStore } from '@/store/terminalHostStore'
import { useTerminalStore } from '@/store/terminalStore'
import { DeclarativeContextMenu } from '@/components/context-menu'
import { XtermSurface } from '@/components/artifact/XtermSurface'
import { cn } from '@/lib/utils'
import { HostKeyMismatchModal } from './HostKeyMismatchModal'
import { TerminalFilesPanel } from './TerminalFilesPanel'

/**
 * Focused managed terminal workspace: chrome + shared XtermSurface (PTY or SSH).
 * Unmount detaches xterm but does not kill backend (D6a keep-alive).
 */
export function ManagedTerminalSession({ terminalId }: { terminalId: string }) {
  const { t } = useTranslation()
  const term = useManagedTerminalStore((s) => s.terminals.find((x) => x.id === terminalId))
  const [bootKey, setBootKey] = useState(0)
  const [hostKeyError, setHostKeyError] = useState<HostKeyMismatchError | null>(null)

  const cwd = term?.cwd
  const kind = term?.kind ?? 'local'
  const hostId = term?.hostId
  const host = useTerminalHostStore((s) =>
    hostId ? s.hosts.find((h) => h.id === hostId) : undefined,
  )

  const restart = useCallback(async () => {
    try {
      if (kind === 'ssh') await sshClose(terminalId)
      else await ptyKill(terminalId)
    } catch {
      /* already dead */
    }
    useTerminalStore.getState().clearSession(terminalId)
    useTerminalStore.getState().ensureSession(terminalId)
    setHostKeyError(null)
    setBootKey((k) => k + 1)
  }, [terminalId, kind])

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

  if (kind === 'local' && !cwd) {
    return (
      <div
        className="flex h-full items-center justify-center text-meta text-ink-tertiary"
        data-testid="managed-terminal-no-cwd"
      >
        {t('terminals.noCwd')}
      </div>
    )
  }

  if (kind === 'ssh' && !hostId) {
    return (
      <div
        className="flex h-full items-center justify-center text-meta text-ink-tertiary"
        data-testid="managed-terminal-no-host"
      >
        {t('terminals.sessionMissing')}
      </div>
    )
  }

  const subtitle =
    kind === 'ssh'
      ? host
        ? `${host.username}@${host.hostname}:${host.port}`
        : hostId
      : cwd

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface" data-testid="managed-terminal-session">
      <DeclarativeContextMenu
        kind="managedTerminal"
        payload={{ terminalId, kind, title: term.title }}
        className="flex min-h-8 shrink-0 items-center justify-between gap-2 border-b border-border/80 px-2.5 py-1"
        data-testid="managed-terminal-chrome"
      >
        <div
          className="flex min-w-0 flex-1 items-center justify-between gap-2"
          data-tauri-drag-region="false"
        >
          <span
            className="min-w-0 flex-1 truncate font-mono text-meta text-ink-tertiary"
            title={`${term.title} — ${subtitle ?? ''}`}
            data-testid="managed-terminal-title"
            data-cwd={cwd}
          >
            <span className="font-sans font-medium text-ink">{term.title}</span>
            {subtitle ? (
              <>
                <span className="mx-1.5 text-ink-tertiary/60" aria-hidden>
                  ·
                </span>
                <span data-testid="managed-terminal-cwd">{subtitle}</span>
              </>
            ) : null}
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

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1">
          {kind === 'local' && cwd ? (
            <XtermSurface
              key={bootKey}
              terminalId={terminalId}
              backend="pty"
              cwd={cwd}
              open={async (cols, rows) => {
                const result = await ptyOpen(terminalId, cwd, cols, rows)
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
          ) : kind === 'ssh' && hostId ? (
            <XtermSurface
              key={bootKey}
              terminalId={terminalId}
              backend="ssh"
              open={async (cols, rows) => {
                try {
                  const result = await sshOpen(terminalId, hostId, cols, rows)
                  if (!result.reused) {
                    try {
                      await recordSuccessfulSshLaunch(hostId, term.title)
                    } catch {
                      /* ignore catalog errors */
                    }
                  }
                  return result
                } catch (e) {
                  const parsed = parseSshInvokeError(e)
                  if (parsed.hostKeyMismatch) {
                    setHostKeyError(parsed.hostKeyMismatch)
                  }
                  throw e
                }
              }}
              write={(data) => sshWrite(terminalId, data)}
              resize={(cols, rows) => sshResize(terminalId, cols, rows)}
              onRestart={restart}
            />
          ) : null}
        </div>

        {kind === 'ssh' ? (
          <TerminalFilesPanel
            terminalId={terminalId}
            backend="sftp"
            remotePath={term.remotePath}
          />
        ) : kind === 'local' && cwd ? (
          <TerminalFilesPanel terminalId={terminalId} backend="local" localRoot={cwd} />
        ) : null}
      </div>

      <HostKeyMismatchModal
        open={hostKeyError != null}
        error={hostKeyError}
        onCancel={() => setHostKeyError(null)}
        onTrusted={() => {
          setHostKeyError(null)
          // Retry open after pin update.
          void restart()
        }}
      />
    </div>
  )
}
