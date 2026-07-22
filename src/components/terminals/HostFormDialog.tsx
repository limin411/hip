import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { nanoid } from 'nanoid'
import { FolderOpen, Loader2 } from 'lucide-react'
import type { HostAuthMethod, HostGroup, TerminalHost } from '@/ipc/terminalHosts'
import {
  deleteSecretRaw,
  hasSecretKeys,
  setSecretRaw,
  sshPassphraseKey,
  sshPasswordKey,
} from '@/ipc/secrets'
import { pickPrivateKeyFile } from '@/ipc/dialog'
import { useTerminalHostStore } from '@/store/terminalHostStore'
import {
  emptyHostFormValues,
  formValuesToHost,
  hostToFormValues,
  isHostFormValid,
  mintHostId,
  validateHostForm,
  type HostFormErrors,
  type HostFormValues,
} from '@/lib/hostFormDraft'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/utils'

export type HostFormMode = { mode: 'create' } | { mode: 'edit'; host: TerminalHost }

const inputCls =
  'h-9 w-full rounded-md border border-border bg-surface px-2.5 text-body text-ink focus-visible:outline-none focus-visible:border-accent focus-visible:ring-[3px] focus-visible:ring-accent/10'

export function HostFormDialog({
  open,
  mode,
  groups,
  onClose,
}: {
  open: boolean
  mode: HostFormMode | null
  groups: HostGroup[]
  onClose: () => void
}) {
  const { t } = useTranslation()
  /** Dynamic form error keys are validated string literals from hostFormDraft. */
  const tr = t as TFunction & ((key: string) => string)
  const upsertHost = useTerminalHostStore((s) => s.upsertHost)

  const [values, setValues] = useState<HostFormValues>(emptyHostFormValues)
  const [passwordSaved, setPasswordSaved] = useState(false)
  const [passphraseSaved, setPassphraseSaved] = useState(false)
  const [errors, setErrors] = useState<HostFormErrors>({})
  const [busy, setBusy] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [hostId, setHostId] = useState<string>('')

  const isEdit = mode?.mode === 'edit'
  const sortedGroups = useMemo(
    () => [...groups].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)),
    [groups],
  )

  // Reset form when dialog opens / mode changes.
  // Always clear secret-presence flags immediately so a previous host's "Saved"
  // state cannot make a new open valid before hasSecretKeys resolves (Issue 1).
  useEffect(() => {
    if (!open || !mode) return
    setErrors({})
    setSubmitError(null)
    setBusy(false)
    setPasswordSaved(false)
    setPassphraseSaved(false)
    if (mode.mode === 'edit') {
      setHostId(mode.host.id)
      setValues(hostToFormValues(mode.host))
    } else {
      setHostId(mintHostId(nanoid))
      setValues(emptyHostFormValues())
    }
  }, [open, mode])

  // Load secret presence for edit mode (source of truth after reset above).
  useEffect(() => {
    if (!open || !mode || mode.mode !== 'edit') return
    let cancelled = false
    const id = mode.host.id
    void (async () => {
      try {
        const flags = await hasSecretKeys([sshPasswordKey(id), sshPassphraseKey(id)])
        if (cancelled) return
        setPasswordSaved(flags[sshPasswordKey(id)] === true)
        setPassphraseSaved(flags[sshPassphraseKey(id)] === true)
      } catch {
        if (!cancelled) {
          setPasswordSaved(false)
          setPassphraseSaved(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, mode])

  const patch = useCallback((partial: Partial<HostFormValues>) => {
    setValues((v) => ({ ...v, ...partial }))
    setErrors({})
  }, [])

  const valid = isHostFormValid(values, {
    mode: isEdit ? 'edit' : 'create',
    passwordSaved,
  })

  const onClearPassword = useCallback(async () => {
    if (!hostId) return
    setBusy(true)
    try {
      await deleteSecretRaw(sshPasswordKey(hostId))
      setPasswordSaved(false)
      setValues((v) => ({ ...v, password: '' }))
    } catch (e) {
      console.error('[hip] clear host password failed:', e)
      setSubmitError(t('terminals.form.errorSave'))
    } finally {
      setBusy(false)
    }
  }, [hostId, t])

  const onClearPassphrase = useCallback(async () => {
    if (!hostId) return
    setBusy(true)
    try {
      await deleteSecretRaw(sshPassphraseKey(hostId))
      setPassphraseSaved(false)
      setValues((v) => ({ ...v, passphrase: '' }))
    } catch (e) {
      console.error('[hip] clear host passphrase failed:', e)
      setSubmitError(t('terminals.form.errorSave'))
    } finally {
      setBusy(false)
    }
  }, [hostId, t])

  const onBrowseKey = useCallback(async () => {
    const path = await pickPrivateKeyFile()
    if (path) patch({ privateKeyPath: path })
  }, [patch])

  const onSubmit = useCallback(async () => {
    if (!mode) return
    const nextErrors = validateHostForm(values, {
      mode: isEdit ? 'edit' : 'create',
      passwordSaved,
    })
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setBusy(true)
    setSubmitError(null)
    const host = formValuesToHost(values, hostId, Date.now())
    // Persist catalog first, then secrets (same safety order as removeHost).
    try {
      await upsertHost(host)
    } catch (e) {
      console.error('[hip] save host catalog failed:', e)
      setSubmitError(t('terminals.form.errorSave'))
      setBusy(false)
      return
    }

    try {
      if (values.authMethod === 'password' && values.password.length > 0) {
        await setSecretRaw(sshPasswordKey(hostId), values.password)
        setPasswordSaved(true)
      }
      if (values.authMethod === 'privateKey' && values.passphrase.length > 0) {
        await setSecretRaw(sshPassphraseKey(hostId), values.passphrase)
        setPassphraseSaved(true)
      }
      // Switching away from password auth: drop password secret.
      if (values.authMethod === 'privateKey' && isEdit) {
        try {
          await deleteSecretRaw(sshPasswordKey(hostId))
        } catch {
          /* ignore */
        }
      }
      // Switching away from privateKey: drop passphrase (key path cleared in meta).
      if (values.authMethod === 'password' && isEdit) {
        try {
          await deleteSecretRaw(sshPassphraseKey(hostId))
        } catch {
          /* ignore */
        }
      }
      onClose()
    } catch (e) {
      // Catalog already persisted; keep dialog open so user can retry secret write.
      console.error('[hip] save host secret failed:', e)
      setSubmitError(t('terminals.form.errorSecretSave'))
    } finally {
      setBusy(false)
    }
  }, [mode, values, isEdit, passwordSaved, hostId, upsertHost, onClose, t])

  if (!mode) return null

  const title =
    mode.mode === 'create' ? t('terminals.form.createTitle') : t('terminals.form.editTitle')

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o && !busy) onClose()
      }}
      title={title}
      closeDisabled={busy}
      className="max-w-md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={busy || !valid}
            data-testid="host-form-save"
            onClick={() => void onSubmit()}
          >
            {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}
            {t('terminals.form.save')}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 p-5" data-testid="host-form-dialog">
        <Field label={t('terminals.form.label')} error={errors.label ? tr(errors.label) : undefined}>
          <Input
            data-testid="host-form-label"
            value={values.label}
            onChange={(e) => patch({ label: e.target.value })}
            autoComplete="off"
            autoFocus
          />
        </Field>

        <div className="grid grid-cols-[1fr_5.5rem] gap-2">
          <Field
            label={t('terminals.form.hostname')}
            error={errors.hostname ? tr(errors.hostname) : undefined}
          >
            <Input
              data-testid="host-form-hostname"
              className="font-mono"
              value={values.hostname}
              onChange={(e) => patch({ hostname: e.target.value })}
              placeholder="example.com"
              autoComplete="off"
            />
          </Field>
          <Field label={t('terminals.form.port')} error={errors.port ? tr(errors.port) : undefined}>
            <Input
              data-testid="host-form-port"
              className="font-mono"
              inputMode="numeric"
              value={values.port}
              onChange={(e) => patch({ port: e.target.value })}
              autoComplete="off"
            />
          </Field>
        </div>

        <Field
          label={t('terminals.form.username')}
          error={errors.username ? tr(errors.username) : undefined}
        >
          <Input
            data-testid="host-form-username"
            value={values.username}
            onChange={(e) => patch({ username: e.target.value })}
            autoComplete="username"
          />
        </Field>

        <Field label={t('terminals.form.authMethod')}>
          <SegmentedControl
            data-testid="host-form-auth"
            aria-label={t('terminals.form.authMethod')}
            value={values.authMethod}
            onChange={(v: HostAuthMethod) => patch({ authMethod: v })}
            options={[
              { value: 'password', label: t('terminals.form.authPassword') },
              { value: 'privateKey', label: t('terminals.form.authPrivateKey') },
            ]}
          />
        </Field>

        {values.authMethod === 'password' ? (
          <Field
            label={t('terminals.form.password')}
            error={errors.password ? tr(errors.password) : undefined}
            trailing={
              passwordSaved ? (
                <Badge variant="success" size="sm" data-testid="host-form-password-saved">
                  {t('terminals.form.passwordSaved')}
                </Badge>
              ) : null
            }
          >
            <Input
              data-testid="host-form-password"
              type="password"
              value={values.password}
              onChange={(e) => patch({ password: e.target.value })}
              placeholder={
                passwordSaved
                  ? t('terminals.form.passwordPlaceholderKeep')
                  : t('terminals.form.passwordPlaceholder')
              }
              autoComplete="new-password"
            />
            {passwordSaved ? (
              <button
                type="button"
                data-testid="host-form-clear-password"
                disabled={busy}
                onClick={() => void onClearPassword()}
                className="mt-1.5 text-meta text-danger hover:underline disabled:opacity-40"
              >
                {t('terminals.form.clearPassword')}
              </button>
            ) : null}
          </Field>
        ) : (
          <>
            <Field
              label={t('terminals.form.privateKeyPath')}
              error={errors.privateKeyPath ? tr(errors.privateKeyPath) : undefined}
            >
              <div className="flex gap-2">
                <Input
                  data-testid="host-form-private-key-path"
                  className="font-mono"
                  value={values.privateKeyPath}
                  onChange={(e) => patch({ privateKeyPath: e.target.value })}
                  placeholder={t('terminals.form.privateKeyPathHint')}
                  autoComplete="off"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-testid="host-form-browse-key"
                  onClick={() => void onBrowseKey()}
                  title={t('terminals.form.browseKey')}
                >
                  <FolderOpen size={14} aria-hidden />
                </Button>
              </div>
            </Field>
            <Field
              label={t('terminals.form.passphrase')}
              trailing={
                passphraseSaved ? (
                  <Badge variant="success" size="sm" data-testid="host-form-passphrase-saved">
                    {t('terminals.form.passphraseSaved')}
                  </Badge>
                ) : null
              }
            >
              <Input
                data-testid="host-form-passphrase"
                type="password"
                value={values.passphrase}
                onChange={(e) => patch({ passphrase: e.target.value })}
                placeholder={
                  passphraseSaved
                    ? t('terminals.form.passwordPlaceholderKeep')
                    : t('terminals.form.passphrasePlaceholder')
                }
                autoComplete="new-password"
              />
              {passphraseSaved ? (
                <button
                  type="button"
                  data-testid="host-form-clear-passphrase"
                  disabled={busy}
                  onClick={() => void onClearPassphrase()}
                  className="mt-1.5 text-meta text-danger hover:underline disabled:opacity-40"
                >
                  {t('terminals.form.clearPassphrase')}
                </button>
              ) : null}
            </Field>
          </>
        )}

        <Field label={t('terminals.form.group')}>
          <select
            data-testid="host-form-group"
            className={cn(inputCls)}
            value={values.groupId}
            onChange={(e) => patch({ groupId: e.target.value })}
          >
            <option value="">{t('terminals.form.groupNone')}</option>
            {sortedGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('terminals.form.remotePath')}>
          <Input
            data-testid="host-form-remote-path"
            className="font-mono"
            value={values.remotePath}
            onChange={(e) => patch({ remotePath: e.target.value })}
            placeholder="/"
            autoComplete="off"
          />
        </Field>

        {submitError ? (
          <p className="text-meta text-danger" role="alert">
            {submitError}
          </p>
        ) : null}
      </div>
    </Modal>
  )
}

function Field({
  label,
  error,
  trailing,
  children,
}: {
  label: string
  error?: string
  trailing?: ReactNode
  children: ReactNode
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label className="block text-meta text-ink-tertiary">{label}</label>
        {trailing}
      </div>
      {children}
      {error ? <p className="mt-1 text-meta text-danger">{error}</p> : null}
    </div>
  )
}
