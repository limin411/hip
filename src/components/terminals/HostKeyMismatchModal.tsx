import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Loader2, ShieldAlert } from 'lucide-react'
import type { HostKeyMismatchError } from '@/ipc/ssh'
import { sshTrustHost } from '@/ipc/ssh'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'

export interface HostKeyMismatchModalProps {
  open: boolean
  error: HostKeyMismatchError | null
  onCancel: () => void
  /** Called after trust is saved; parent should retry connect. */
  onTrusted: () => void
}

/**
 * TOFU host-key mismatch modal (K7).
 * Shows SHA256 fingerprint; user can trust (update pin) or cancel.
 */
export function HostKeyMismatchModal({
  open,
  error,
  onCancel,
  onTrusted,
}: HostKeyMismatchModalProps) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const copyFingerprint = useCallback(async () => {
    if (!error?.fingerprint) return
    try {
      await navigator.clipboard.writeText(error.fingerprint)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard may be denied */
    }
  }, [error?.fingerprint])

  const trust = useCallback(async () => {
    if (!error) return
    setBusy(true)
    setErrMsg(null)
    try {
      await sshTrustHost(
        error.hostname,
        error.port,
        error.publicKey,
        error.fingerprint,
      )
      onTrusted()
    } catch (e) {
      console.error('[hip] ssh_trust_host failed:', e)
      setErrMsg(t('terminals.hostKey.trustFailed'))
    } finally {
      setBusy(false)
    }
  }, [error, onTrusted, t])

  if (!error) return null

  const hostLabel = `${error.hostname}:${error.port}`

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o && !busy) onCancel()
      }}
      title={t('terminals.hostKey.title')}
      className="max-w-md"
      closeDisabled={busy}
    >
      <div className="space-y-4 p-5" data-testid="host-key-mismatch-modal">
        <div className="flex items-start gap-3">
          <ShieldAlert
            size={20}
            className="mt-0.5 shrink-0 text-danger"
            aria-hidden
          />
          <div className="min-w-0 space-y-2">
            <p className="text-body text-ink-secondary">
              {t('terminals.hostKey.body', { host: hostLabel })}
            </p>
            <div>
              <div className="mb-1 text-meta text-ink-tertiary">
                {t('terminals.hostKey.fingerprint')}
              </div>
              <code
                className="block break-all rounded-md border border-border bg-surface-muted px-2.5 py-2 font-mono text-meta text-ink"
                data-testid="host-key-fingerprint"
              >
                {error.fingerprint}
              </code>
            </div>
            {error.previousFingerprint ? (
              <div>
                <div className="mb-1 text-meta text-ink-tertiary">
                  {t('terminals.hostKey.previousFingerprint')}
                </div>
                <code className="block break-all rounded-md border border-border bg-surface-muted/60 px-2.5 py-2 font-mono text-caption text-ink-tertiary">
                  {error.previousFingerprint}
                </code>
              </div>
            ) : null}
          </div>
        </div>

        {errMsg ? (
          <p className="text-meta text-danger" role="alert">
            {errMsg}
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="host-key-copy"
            onClick={() => void copyFingerprint()}
            disabled={busy}
          >
            <Copy size={13} aria-hidden />
            {copied ? t('terminals.hostKey.copied') : t('terminals.hostKey.copyFingerprint')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={onCancel}
            data-testid="host-key-cancel"
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            data-testid="host-key-trust"
            disabled={busy}
            onClick={() => void trust()}
          >
            {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}
            {t('terminals.hostKey.trustAndConnect')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
