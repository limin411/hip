import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { listenSftpProgress, sftpCancel } from '@/ipc/sftp'
import { useTerminalFsStore } from '@/store/terminalFsStore'
import { TerminalFileTree } from './TerminalFileTree'
import { cn } from '@/lib/utils'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/**
 * In-page files panel for managed SSH sessions: remote SFTP tree + transfer progress.
 */
export function TerminalFilesPanel({
  terminalId,
  remotePath,
}: {
  terminalId: string
  remotePath?: string
}) {
  const { t } = useTranslation()
  const transfers = useTerminalFsStore((s) =>
    s.transfers.filter((x) => x.terminalId === terminalId),
  )

  // Bridge sftp:progress → store (one listener per mount is fine; filter by terminalId).
  useEffect(() => {
    let unlisten: (() => void) | undefined
    let cancelled = false
    void listenSftpProgress((ev) => {
      if (ev.terminalId !== terminalId) return
      const existing = useTerminalFsStore
        .getState()
        .transfers.find((x) => x.opId === ev.opId)
      useTerminalFsStore.getState().upsertTransfer({
        opId: ev.opId,
        terminalId: ev.terminalId,
        kind: existing?.kind ?? 'download',
        label: existing?.label ?? ev.opId,
        phase: ev.phase,
        bytes: ev.bytes,
        total: ev.total,
        message: ev.message,
      })
      if (ev.phase === 'completed' || ev.phase === 'cancelled' || ev.phase === 'error') {
        // Keep terminal status briefly then drop.
        window.setTimeout(() => {
          useTerminalFsStore.getState().removeTransfer(ev.opId)
        }, 2500)
      }
    }).then((u) => {
      if (cancelled) u()
      else unlisten = u
    })
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [terminalId])

  return (
    <aside
      className="hidden w-60 shrink-0 flex-col border-l border-border bg-surface-muted/30 sm:flex"
      data-testid="managed-terminal-files"
    >
      <div className="flex h-8 shrink-0 items-center border-b border-border/80 px-2.5">
        <p className="text-meta font-medium text-ink">{t('terminals.sftp.panelTitle')}</p>
      </div>
      <div className="min-h-0 flex-1">
        <TerminalFileTree terminalId={terminalId} initialPath={remotePath} />
      </div>
      {transfers.length > 0 ? (
        <div
          className="shrink-0 border-t border-border/80 px-2 py-1.5"
          data-testid="sftp-transfers"
        >
          {transfers.map((tr) => {
            const pct =
              tr.total && tr.total > 0
                ? Math.min(100, Math.round((tr.bytes / tr.total) * 100))
                : null
            const active = tr.phase === 'started' || tr.phase === 'progress'
            return (
              <div
                key={tr.opId}
                className="mb-1.5 last:mb-0"
                data-testid="sftp-transfer-row"
                data-phase={tr.phase}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="min-w-0 flex-1 truncate text-caption text-ink-secondary" title={tr.label}>
                    {tr.kind === 'upload'
                      ? t('terminals.sftp.uploading')
                      : t('terminals.sftp.downloading')}
                    {': '}
                    {tr.label}
                  </span>
                  {active ? (
                    <button
                      type="button"
                      title={t('terminals.sftp.cancel')}
                      className="rounded p-0.5 text-ink-tertiary hover:bg-state-hover hover:text-ink"
                      onClick={() => void sftpCancel(terminalId, tr.opId)}
                    >
                      <X size={12} />
                    </button>
                  ) : null}
                </div>
                <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-surface-muted">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      tr.phase === 'error'
                        ? 'bg-red-500/80'
                        : tr.phase === 'cancelled'
                          ? 'bg-ink-tertiary/40'
                          : tr.phase === 'completed'
                            ? 'bg-emerald-500/80'
                            : 'bg-accent',
                    )}
                    style={{ width: pct != null ? `${pct}%` : active ? '30%' : '100%' }}
                  />
                </div>
                <p className="mt-0.5 text-[10px] text-ink-tertiary">
                  {formatBytes(tr.bytes)}
                  {tr.total != null ? ` / ${formatBytes(tr.total)}` : ''}
                  {tr.phase === 'completed'
                    ? ` · ${t('terminals.sftp.done')}`
                    : tr.phase === 'cancelled'
                      ? ` · ${t('terminals.sftp.cancelled')}`
                      : tr.phase === 'error'
                        ? ` · ${t('terminals.sftp.failed')}`
                        : ''}
                </p>
              </div>
            )
          })}
        </div>
      ) : null}
    </aside>
  )
}
