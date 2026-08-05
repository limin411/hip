// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import type { TerminalHost } from '@/ipc/terminalHosts'

const removeHost = vi.fn().mockResolvedValue(undefined)
const load = vi.fn().mockResolvedValue(undefined)
const openLocal = vi.fn().mockResolvedValue('tm_x')
const openSsh = vi.fn().mockResolvedValue('tm_ssh')
const close = vi.fn().mockResolvedValue(undefined)
const removeRecord = vi.fn()

let hosts: TerminalHost[] = []
let groups: { id: string; name: string; sort: number }[] = []

vi.mock('@/store/terminalHostStore', () => {
  const store = (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      groups,
      hosts,
      loaded: true,
      error: null,
      load,
      upsertGroup: vi.fn(),
      removeGroup: vi.fn(),
      removeHost,
    })
  store.getState = () => ({
    loaded: true,
    load,
    groups,
    hosts,
    removeHost,
  })
  return { useTerminalHostStore: store }
})

vi.mock('@/store/managedTerminalStore', () => {
  const terminals = [
    {
      id: 'tm_ssh1',
      kind: 'ssh',
      hostId: 'hst_1',
      title: 'ops',
      status: 'connected',
      createdAt: 1,
    },
  ]
  const store = (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ terminals, focus: vi.fn() })
  store.getState = () => ({
    openLocal,
    openSsh,
    close,
    terminals,
    focus: vi.fn(),
    removeRecord,
  })
  return { useManagedTerminalStore: store }
})

vi.mock('@/ipc/dialog', () => ({
  pickPrivateKeyFile: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/ipc/secrets', () => ({
  hasSecretKeys: vi.fn().mockResolvedValue({}),
  setSecretRaw: vi.fn(),
  deleteSecretRaw: vi.fn(),
  sshPasswordKey: (id: string) => `hip.ssh.${id}.password`,
  sshPassphraseKey: (id: string) => `hip.ssh.${id}.passphrase`,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { label?: string; name?: string; count?: number }) => {
      if (opts?.label) return `${key}:${opts.label}`
      if (opts?.name) return `${key}:${opts.name}`
      if (opts?.count != null) return `${key}:${opts.count}`
      return key
    },
  }),
}))

vi.mock('nanoid', () => ({ nanoid: () => 'g1' }))

import { HostLibrary } from './HostLibrary'

describe('HostLibrary', () => {
  beforeEach(() => {
    hosts = []
    groups = []
    removeHost.mockClear().mockResolvedValue(undefined)
    close.mockClear().mockResolvedValue(undefined)
    removeRecord.mockClear()
    openLocal.mockClear().mockResolvedValue('tm_x')
    openSsh.mockClear().mockResolvedValue('tm_ssh')
  })

  afterEach(() => {
    cleanup()
  })

  it('shows empty library state with CTAs', () => {
    render(<HostLibrary />)
    expect(screen.getByTestId('host-library-empty')).toBeInTheDocument()
    expect(screen.getByTestId('host-library-empty-new-remote')).toBeInTheDocument()
    expect(screen.getByTestId('host-library-empty-new-local')).toBeInTheDocument()
  })

  it('lists hosts and enables Connect (calls openSsh)', async () => {
    hosts = [
      {
        id: 'hst_1',
        label: 'ops-1',
        hostname: '10.0.0.1',
        port: 22,
        username: 'root',
        authMethod: 'password',
        updatedAt: 1,
      },
    ]
    render(<HostLibrary />)
    expect(screen.getByTestId('host-row-hst_1')).toBeInTheDocument()
    const connect = screen.getByTestId('host-connect-hst_1')
    expect(connect).not.toBeDisabled()
    fireEvent.click(connect)
    await waitFor(() => {
      expect(openSsh).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'hst_1', hostname: '10.0.0.1' }),
      )
    })
  })

  it('delete confirm cascades: close records, remove records, then removeHost', async () => {
    hosts = [
      {
        id: 'hst_1',
        label: 'ops-1',
        hostname: '10.0.0.1',
        port: 22,
        username: 'root',
        authMethod: 'password',
        updatedAt: 1,
      },
    ]
    render(<HostLibrary />)
    fireEvent.click(screen.getByTestId('host-delete-hst_1'))
    expect(screen.getByTestId('host-delete-dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('host-delete-confirm'))

    await waitFor(() => {
      expect(close).toHaveBeenCalledWith('tm_ssh1')
      expect(removeRecord).toHaveBeenCalledWith('tm_ssh1')
      expect(removeHost).toHaveBeenCalledWith('hst_1')
    })
    expect(close.mock.invocationCallOrder[0]!).toBeLessThan(
      removeHost.mock.invocationCallOrder[0]!,
    )
  })

  it('opens create form from empty state', async () => {
    render(<HostLibrary />)
    fireEvent.click(screen.getByTestId('host-library-empty-new-remote'))
    await waitFor(() => {
      expect(screen.getByTestId('host-form-dialog')).toBeInTheDocument()
    })
  })

  it('rejects duplicate group names (case-insensitive)', async () => {
    const { useHostLibraryUi } = await import('./hostLibraryUi')
    useHostLibraryUi.setState({ pendingCreateGroup: true })
    groups = [{ id: 'g1', name: 'Prod', sort: 0 }]
    render(<HostLibrary />)
    await waitFor(() => {
      expect(screen.getByTestId('host-group-dialog')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByTestId('host-group-name'), { target: { value: 'prod' } })
    fireEvent.click(screen.getByTestId('host-group-save'))
    await waitFor(() => {
      expect(screen.getByText('terminals.form.groupNameDuplicate')).toBeInTheDocument()
    })
  })

  it('consumes pendingCreateHost once — remount does not re-open form', async () => {
    const { useHostLibraryUi } = await import('./hostLibraryUi')
    useHostLibraryUi.setState({ pendingCreateHost: true })

    const { unmount } = render(<HostLibrary />)
    await waitFor(() => {
      expect(screen.getByTestId('host-form-dialog')).toBeInTheDocument()
    })
    expect(useHostLibraryUi.getState().pendingCreateHost).toBe(false)

    unmount()
    render(<HostLibrary />)
    // Stale request already consumed — form stays closed on remount.
    expect(screen.queryByTestId('host-form-dialog')).not.toBeInTheDocument()
  })

  it('consumes pendingCreateGroup once — remount does not re-open dialog', async () => {
    const { useHostLibraryUi } = await import('./hostLibraryUi')
    useHostLibraryUi.setState({ pendingCreateGroup: true })

    const { unmount } = render(<HostLibrary />)
    await waitFor(() => {
      expect(screen.getByTestId('host-group-dialog')).toBeInTheDocument()
    })
    expect(useHostLibraryUi.getState().pendingCreateGroup).toBe(false)

    unmount()
    render(<HostLibrary />)
    // Stale request already consumed — dialog stays closed on remount.
    expect(screen.queryByTestId('host-group-dialog')).not.toBeInTheDocument()
  })

  it('opens group dialog from rail new group button', async () => {
    groups = [{ id: 'g1', name: 'Prod', sort: 0 }]
    render(<HostLibrary />)
    fireEvent.click(screen.getByTestId('host-group-create'))
    await waitFor(() => {
      expect(screen.getByTestId('host-group-dialog')).toBeInTheDocument()
    })
  })

  it('opens new connection from host row with current group preselected', async () => {
    groups = [{ id: 'g1', name: 'Prod', sort: 0 }]
    hosts = [
      {
        id: 'hst_1',
        label: 'ops-1',
        groupId: 'g1',
        hostname: '10.0.0.1',
        port: 22,
        username: 'root',
        authMethod: 'password',
        updatedAt: 1,
      },
    ]
    render(<HostLibrary />)
    fireEvent.click(screen.getByTestId('host-add'))
    await waitFor(() => {
      expect(screen.getByTestId('host-form-dialog')).toBeInTheDocument()
    })
    expect(screen.getByTestId('host-form-group')).toHaveValue('g1')
  })
})
