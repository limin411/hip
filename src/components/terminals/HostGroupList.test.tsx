// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react'
import type { HostGroup, TerminalHost } from '@/ipc/terminalHosts'
import { HostGroupList } from './HostGroupList'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) =>
      opts?.count != null ? `${key}:${opts.count}` : key,
  }),
}))

const groups: HostGroup[] = [
  { id: 'g1', name: 'Prod', sort: 0 },
  { id: 'g2', name: 'Dev', sort: 1 },
]

const hosts: TerminalHost[] = [
  {
    id: 'h1',
    label: 'web',
    groupId: 'g1',
    hostname: 'a.example',
    port: 22,
    username: 'u',
    authMethod: 'password',
    updatedAt: 1,
  },
  {
    id: 'h2',
    label: 'db',
    groupId: 'g1',
    hostname: 'b.example',
    port: 22,
    username: 'u',
    authMethod: 'password',
    updatedAt: 1,
  },
  {
    id: 'h3',
    label: 'loose',
    hostname: 'c.example',
    port: 22,
    username: 'u',
    authMethod: 'password',
    updatedAt: 1,
  },
]

const noop = vi.fn()

describe('HostGroupList master-detail', () => {
  afterEach(() => cleanup())

  it('orders groups by name ascending (Dev before Prod)', () => {
    render(
      <HostGroupList
        groups={groups}
        hosts={hosts}
        onEditHost={noop}
        onDeleteHost={noop}
        onRenameGroup={noop}
        onDeleteGroup={noop}
      />,
    )
    const sections = screen.getAllByTestId(/^host-group-g/)
    expect(sections.map((el) => el.getAttribute('data-testid'))).toEqual([
      'host-group-g2', // Dev
      'host-group-g1', // Prod
    ])
  })

  it('selects first group by default and shows only its hosts', () => {
    render(
      <HostGroupList
        groups={groups}
        hosts={hosts}
        onEditHost={noop}
        onDeleteHost={noop}
        onRenameGroup={noop}
        onDeleteGroup={noop}
      />,
    )
    // Dev first → only its hosts (none) — wait, Dev has no hosts
    // First nav is Dev (g2) which has 0 hosts
    expect(screen.getByTestId('host-group-select-g2')).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByTestId('host-row-h1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('host-row-h3')).not.toBeInTheDocument()
    expect(screen.getByTestId('host-group-empty')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('host-group-select-g1'))
    expect(screen.getByTestId('host-group-select-g1')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('host-row-h1')).toBeInTheDocument()
    expect(screen.getByTestId('host-row-h2')).toBeInTheDocument()
    expect(screen.queryByTestId('host-row-h3')).not.toBeInTheDocument()
  })

  it('selecting ungrouped shows only ungrouped hosts', () => {
    render(
      <HostGroupList
        groups={groups}
        hosts={hosts}
        onEditHost={noop}
        onDeleteHost={noop}
        onRenameGroup={noop}
        onDeleteGroup={noop}
      />,
    )
    fireEvent.click(screen.getByTestId('host-group-select-ungrouped'))
    expect(screen.getByTestId('host-row-h3')).toBeInTheDocument()
    expect(screen.queryByTestId('host-row-h1')).not.toBeInTheDocument()
  })

  it('rename / delete stay clickable without changing selection hosts incorrectly', () => {
    const onRename = vi.fn()
    const onDelete = vi.fn()
    render(
      <HostGroupList
        groups={groups}
        hosts={hosts}
        onEditHost={noop}
        onDeleteHost={noop}
        onRenameGroup={onRename}
        onDeleteGroup={onDelete}
      />,
    )
    fireEvent.click(screen.getByTestId('host-group-select-g1'))
    fireEvent.click(screen.getByTestId('host-group-rename-g1'))
    expect(onRename).toHaveBeenCalledWith(groups[0])
    fireEvent.click(screen.getByTestId('host-group-delete-g1'))
    expect(onDelete).toHaveBeenCalledWith(groups[0])
    expect(screen.getByTestId('host-row-h1')).toBeInTheDocument()
  })

  it('row body click connects host; edit does not', () => {
    const onConnect = vi.fn()
    const onEdit = vi.fn()
    render(
      <HostGroupList
        groups={groups}
        hosts={hosts}
        onEditHost={onEdit}
        onDeleteHost={noop}
        onRenameGroup={noop}
        onDeleteGroup={noop}
        onConnectHost={onConnect}
      />,
    )
    fireEvent.click(screen.getByTestId('host-group-select-g1'))
    fireEvent.click(screen.getByTestId('host-row-h1'))
    expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({ id: 'h1' }))

    onConnect.mockClear()
    fireEvent.click(screen.getByTestId('host-edit-h1'))
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'h1' }))
    expect(onConnect).not.toHaveBeenCalled()
  })

  it('empty group shows empty placeholder and add', () => {
    const onAddHost = vi.fn()
    render(
      <HostGroupList
        groups={[{ id: 'g-empty', name: 'Empty', sort: 0 }]}
        hosts={[]}
        onEditHost={noop}
        onDeleteHost={noop}
        onRenameGroup={noop}
        onDeleteGroup={noop}
        onAddHost={onAddHost}
      />,
    )
    expect(screen.getByTestId('host-group-empty')).toBeInTheDocument()
    expect(screen.getByText('terminals.groupEmpty')).toBeInTheDocument()
    fireEvent.click(within(screen.getByTestId('host-group-empty')).getByRole('button'))
    expect(onAddHost).toHaveBeenCalledWith('g-empty')
  })

  it('falls back selection when selected group is removed', () => {
    const { rerender } = render(
      <HostGroupList
        groups={groups}
        hosts={hosts}
        onEditHost={noop}
        onDeleteHost={noop}
        onRenameGroup={noop}
        onDeleteGroup={noop}
      />,
    )
    fireEvent.click(screen.getByTestId('host-group-select-g1'))
    expect(screen.getByTestId('host-row-h1')).toBeInTheDocument()

    rerender(
      <HostGroupList
        groups={[{ id: 'g2', name: 'Dev', sort: 1 }]}
        hosts={hosts.filter((h) => h.groupId !== 'g1')}
        onEditHost={noop}
        onDeleteHost={noop}
        onRenameGroup={noop}
        onDeleteGroup={noop}
      />,
    )
    expect(screen.getByTestId('host-group-select-g2')).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByTestId('host-row-h1')).not.toBeInTheDocument()
  })
})
