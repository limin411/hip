// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
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

describe('HostGroupList collapse', () => {
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

  it('starts expanded and can collapse / expand a group', () => {
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
    expect(screen.getByTestId('host-row-h1')).toBeInTheDocument()
    expect(screen.getByTestId('host-row-h2')).toBeInTheDocument()

    const toggle = screen.getByTestId('host-group-toggle-g1')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('host-row-h1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('host-row-h2')).not.toBeInTheDocument()
    // Other groups / ungrouped stay visible
    expect(screen.getByTestId('host-row-h3')).toBeInTheDocument()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('host-row-h1')).toBeInTheDocument()
  })

  it('collapses ungrouped section independently', () => {
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
    fireEvent.click(screen.getByTestId('host-group-toggle-ungrouped'))
    expect(screen.queryByTestId('host-row-h3')).not.toBeInTheDocument()
    expect(screen.getByTestId('host-row-h1')).toBeInTheDocument()
  })

  it('rename / delete stay clickable without toggling', () => {
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
    fireEvent.click(screen.getByTestId('host-group-rename-g1'))
    expect(onRename).toHaveBeenCalledWith(groups[0])
    fireEvent.click(screen.getByTestId('host-group-delete-g1'))
    expect(onDelete).toHaveBeenCalledWith(groups[0])
    // Still expanded after rename/delete clicks
    expect(screen.getByTestId('host-row-h1')).toBeInTheDocument()
  })

  it('renders add cards per group and ungrouped; add calls onAddHost with group id', () => {
    const onAddHost = vi.fn()
    render(
      <HostGroupList
        groups={groups}
        hosts={hosts}
        onEditHost={noop}
        onDeleteHost={noop}
        onRenameGroup={noop}
        onDeleteGroup={noop}
        onAddHost={onAddHost}
      />,
    )
    expect(screen.getByTestId('host-add-g1')).toBeInTheDocument()
    expect(screen.getByTestId('host-add-g2')).toBeInTheDocument()
    expect(screen.getByTestId('host-add-ungrouped')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('host-add-g1'))
    expect(onAddHost).toHaveBeenCalledWith('g1')
    fireEvent.click(screen.getByTestId('host-add-ungrouped'))
    expect(onAddHost).toHaveBeenCalledWith(null)
  })

  it('card body click connects host; edit does not', () => {
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
    fireEvent.click(screen.getByTestId('host-row-h1'))
    expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({ id: 'h1' }))

    onConnect.mockClear()
    fireEvent.click(screen.getByTestId('host-edit-h1'))
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'h1' }))
    expect(onConnect).not.toHaveBeenCalled()
  })

  it('empty group still shows add card (no empty placeholder)', () => {
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
    expect(screen.getByTestId('host-add-g-empty')).toBeInTheDocument()
    expect(screen.queryByText('terminals.groupEmpty')).not.toBeInTheDocument()
  })
})
