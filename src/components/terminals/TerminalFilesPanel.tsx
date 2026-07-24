import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { listenSftpProgress, sftpCancel } from '@/ipc/sftp'
import { useTerminalFsStore } from '@/store/terminalFsStore'
import { PanelToggle } from '@/components/layout/PanelToggle'
import { TerminalFileTree, type TerminalFileTreeBackend } from './TerminalFileTree'
import { cn } from '@/lib/utils'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/**
 * Managed-terminal files rail (local term_fs or remote SFTP).
 * Shell right drawer chrome matches ArtifactPanel / PreviewPanel / KnowledgeOutlinePanel.
 */
export function TerminalFilesPanel({
  terminalId,
  remotePath,
  backend = 'sftp',
  localRoot,
}: {
  terminalId: string
  remotePath?: string
  backend?: TerminalFileTreeBackend
  /** Launch cwd for local tree root label / open-folder. */
  localRoot?: string
}) {
  const { t } = useTranslation()
  // Select the stable store array, then filter in useMemo. Returning a fresh
  // `.filter()` array from a zustand selector breaks useSyncExternalStore
  // equality (new ref every snapshot) and triggers "Maximum update depth exceeded".
  const allTransfers = useTerminalFsStore((s) => s.transfers)
  const transfers = useMemo(
    () => allTransfers.filter((x) => x.terminalId === terminalId),
    [allTransfers, terminalId],
  )

  // Bridge sftp:progress → store (SSH only).
  useEffect(() => {
    if (backend !== 'sftp') return
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
  }, [terminalId, backend])

  const panelTitle =
    backend === 'local' ? t('terminals.localFs.panelTitle') : t('terminals.sftp.panelTitle')
  const initialPath = backend === 'local' ? localRoot : remotePath

  return (
    <div
      className="flex h-full min-h-0 flex-col border-l border-border bg-surface"
      data-testid="managed-terminal-files"
      data-backend={backend}
    >
      {/* Same titlebar chrome as ArtifactPanel / KnowledgeOutlinePanel / PreviewPanel */}
      <div
        data-tauri-drag-region
        className="flex h-[var(--titlebar-height)] shrink-0 items-center justify-between border-b border-border px-2"
      >
        <span
          className="truncate px-1.5 text-body font-medium tracking-tight text-ink"
          data-tauri-drag-region="false"
          data-testid="panel-title"
        >
          {panelTitle}
        </span>
        {/* Relocated from main toolbar when open — same toggle collapses the rail. */}
        <PanelToggle slot="panel" />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <TerminalFileTree
          terminalId={terminalId}
          initialPath={initialPath}
          backend={backend}
        />
      </div>
      {backend === 'sftp' && transfers.length > 0 ? (
        <div
          className="shrink-0 border-t border-border px-2 py-1.5"
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
                  <span
                    className="min-w-0 flex-1 truncate text-caption text-ink-secondary"
                    title={tr.label}
                  >
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
    </div>
  )
}
