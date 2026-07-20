// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import type { TerminalHost } from '@/ipc/terminalHosts'

const upsertHost = vi.fn().mockResolvedValue(undefined)
const hasSecretKeys = vi.fn()
const setSecretRaw = vi.fn().mockResolvedValue(undefined)
const deleteSecretRaw = vi.fn().mockResolvedValue(undefined)

vi.mock('@/store/terminalHostStore', () => ({
  useTerminalHostStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      upsertHost,
    }),
}))

vi.mock('@/ipc/secrets', () => ({
  hasSecretKeys: (...a: unknown[]) => hasSecretKeys(...a),
  setSecretRaw: (...a: unknown[]) => setSecretRaw(...a),
  deleteSecretRaw: (...a: unknown[]) => deleteSecretRaw(...a),
  sshPasswordKey: (id: string) => `hip.ssh.${id}.password`,
  sshPassphraseKey: (id: string) => `hip.ssh.${id}.passphrase`,
}))

vi.mock('@/ipc/dialog', () => ({
  pickPrivateKeyFile: vi.fn().mockResolvedValue(null),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('nanoid', () => ({
  nanoid: () => 'testid',
}))

import { HostFormDialog } from './HostFormDialog'

const host: TerminalHost = {
  id: 'hst_existing',
  label: 'ops',
  hostname: 'example.com',
  port: 22,
  username: 'root',
  authMethod: 'password',
  updatedAt: 1,
}

describe('HostFormDialog', () => {
  beforeEach(() => {
    upsertHost.mockClear().mockResolvedValue(undefined)
    setSecretRaw.mockClear().mockResolvedValue(undefined)
    deleteSecretRaw.mockClear().mockResolvedValue(undefined)
    hasSecretKeys.mockReset().mockResolvedValue({
      'hip.ssh.hst_existing.password': true,
      'hip.ssh.hst_existing.passphrase': false,
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('creates host then writes password secret', async () => {
    render(
      <HostFormDialog
        open
        mode={{ mode: 'create' }}
        groups={[]}
        onClose={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByTestId('host-form-label'), { target: { value: 'dev' } })
    fireEvent.change(screen.getByTestId('host-form-hostname'), {
      target: { value: 'dev.local' },
    })
    fireEvent.change(screen.getByTestId('host-form-username'), { target: { value: 'me' } })
    fireEvent.change(screen.getByTestId('host-form-password'), {
      target: { value: 'hunter2' },
    })

    fireEvent.click(screen.getByTestId('host-form-save'))

    await waitFor(() => {
      expect(upsertHost).toHaveBeenCalledTimes(1)
    })
    const saved = upsertHost.mock.calls[0]![0] as TerminalHost
    expect(saved.id).toBe('hst_testid')
    expect(saved.label).toBe('dev')
    expect(saved.hostname).toBe('dev.local')
    expect(saved.username).toBe('me')
    expect(saved.authMethod).toBe('password')
    expect(saved.port).toBe(22)

    await waitFor(() => {
      expect(setSecretRaw).toHaveBeenCalledWith('hip.ssh.hst_testid.password', 'hunter2')
    })
  })

  it('edit keeps password when field left blank and shows saved badge', async () => {
    const onClose = vi.fn()
    render(
      <HostFormDialog
        open
        mode={{ mode: 'edit', host }}
        groups={[]}
        onClose={onClose}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('host-form-password-saved')).toBeInTheDocument()
    })

    // Leave password blank; should still save meta.
    fireEvent.change(screen.getByTestId('host-form-label'), {
      target: { value: 'ops-renamed' },
    })
    fireEvent.click(screen.getByTestId('host-form-save'))

    await waitFor(() => {
      expect(upsertHost).toHaveBeenCalled()
    })
    expect(setSecretRaw).not.toHaveBeenCalled()
    const saved = upsertHost.mock.calls[0]![0] as TerminalHost
    expect(saved.id).toBe('hst_existing')
    expect(saved.label).toBe('ops-renamed')
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('clear password calls deleteSecretRaw', async () => {
    render(
      <HostFormDialog
        open
        mode={{ mode: 'edit', host }}
        groups={[]}
        onClose={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('host-form-clear-password')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('host-form-clear-password'))

    await waitFor(() => {
      expect(deleteSecretRaw).toHaveBeenCalledWith('hip.ssh.hst_existing.password')
    })
  })

  it('disables save until required fields are filled', () => {
    render(
      <HostFormDialog open mode={{ mode: 'create' }} groups={[]} onClose={vi.fn()} />,
    )
    expect(screen.getByTestId('host-form-save')).toBeDisabled()
  })

  it('clears passwordSaved on edit open until hasSecretKeys resolves', async () => {
    // Slow presence check — must not treat a prior host's secret as present.
    let resolveKeys!: (v: Record<string, boolean>) => void
    hasSecretKeys.mockImplementation(
      () =>
        new Promise<Record<string, boolean>>((resolve) => {
          resolveKeys = resolve
        }),
    )

    render(
      <HostFormDialog open mode={{ mode: 'edit', host }} groups={[]} onClose={vi.fn()} />,
    )

    // Before IPC resolves: no Saved badge; Save disabled (password blank + not saved).
    expect(screen.queryByTestId('host-form-password-saved')).not.toBeInTheDocument()
    expect(screen.getByTestId('host-form-save')).toBeDisabled()

    resolveKeys({
      'hip.ssh.hst_existing.password': true,
      'hip.ssh.hst_existing.passphrase': false,
    })
    await waitFor(() => {
      expect(screen.getByTestId('host-form-password-saved')).toBeInTheDocument()
    })
    expect(screen.getByTestId('host-form-save')).not.toBeDisabled()
  })

  it('keeps dialog open with secret error when setSecretRaw fails after catalog save', async () => {
    setSecretRaw.mockRejectedValueOnce(new Error('disk full'))
    const onClose = vi.fn()
    render(
      <HostFormDialog open mode={{ mode: 'create' }} groups={[]} onClose={onClose} />,
    )
    fireEvent.change(screen.getByTestId('host-form-label'), { target: { value: 'dev' } })
    fireEvent.change(screen.getByTestId('host-form-hostname'), {
      target: { value: 'dev.local' },
    })
    fireEvent.change(screen.getByTestId('host-form-username'), { target: { value: 'me' } })
    fireEvent.change(screen.getByTestId('host-form-password'), {
      target: { value: 'hunter2' },
    })
    fireEvent.click(screen.getByTestId('host-form-save'))

    await waitFor(() => {
      expect(upsertHost).toHaveBeenCalled()
      expect(setSecretRaw).toHaveBeenCalled()
    })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('terminals.form.errorSecretSave')
  })
})
