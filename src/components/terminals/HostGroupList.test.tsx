// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react'
import React from 'react'
import type { HostGroup, TerminalHost } from '@/ipc/terminalHosts'
import { HOST_LIST_PAGE_SIZE } from '@/lib/hostGroupUi'
import { HostGroupList } from './HostGroupList'

vi.mock('react-resizable-panels', () => ({
  Panel: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'resizable-panel' }, children),
  PanelGroup: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'panel-group' }, children),
  PanelResizeHandle: () => React.createElement('div', { 'data-testid': 'resize-handle' }),
}))

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

  it('keeps create + ungrouped fixed on top, groups below sorted by name', () => {
    render(
      <HostGroupList
        groups={groups}
        hosts={hosts}
        onEditHost={noop}
        onDeleteHost={noop}
        onRenameGroup={noop}
        onDeleteGroup={noop}
        onCreateGroup={noop}
      />,
    )
    const create = screen.getByTestId('host-group-create')
    const ungrouped = screen.getByTestId('host-group-ungrouped')
    expect(create.compareDocumentPosition(ungrouped) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const sections = screen.getAllByTestId(/^host-group-g/)
    expect(sections.map((el) => el.getAttribute('data-testid'))).toEqual([
      'host-group-g2', // Dev
      'host-group-g1', // Prod
    ])
    expect(ungrouped.compareDocumentPosition(sections[0]!) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy()
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

  it('keeps ungrouped in the rail even with no ungrouped hosts', () => {
    render(
      <HostGroupList
        groups={groups}
        hosts={hosts.filter((h) => h.groupId != null)}
        onEditHost={noop}
        onDeleteHost={noop}
        onRenameGroup={noop}
        onDeleteGroup={noop}
      />,
    )
    expect(screen.getByTestId('host-group-select-ungrouped')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('host-group-select-ungrouped'))
    expect(screen.getByTestId('host-group-empty')).toBeInTheDocument()
  })

  it('renders new group button above ungrouped and calls back', () => {
    const onCreateGroup = vi.fn()
    render(
      <HostGroupList
        groups={groups}
        hosts={hosts}
        onEditHost={noop}
        onDeleteHost={noop}
        onRenameGroup={noop}
        onDeleteGroup={noop}
        onCreateGroup={onCreateGroup}
      />,
    )
    const button = screen.getByTestId('host-group-create')
    expect(button).toBeInTheDocument()
    expect(button.compareDocumentPosition(screen.getByTestId('host-group-ungrouped')) &
      Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(button)
    expect(onCreateGroup).toHaveBeenCalledOnce()
  })

  it('hides new group button when no callback is provided', () => {
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
    expect(screen.queryByTestId('host-group-create')).not.toBeInTheDocument()
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

  it('new connection at list bottom uses the current group', () => {
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
    fireEvent.click(screen.getByTestId('host-group-select-g1'))
    fireEvent.click(screen.getByTestId('host-add'))
    expect(onAddHost).toHaveBeenCalledWith('g1')

    fireEvent.click(screen.getByTestId('host-group-select-ungrouped'))
    fireEvent.click(screen.getByTestId('host-add'))
    expect(onAddHost).toHaveBeenLastCalledWith(null)
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

  it('keeps the search field mounted on an empty group', () => {
    render(
      <HostGroupList
        groups={[{ id: 'g-empty', name: 'Empty', sort: 0 }]}
        hosts={[]}
        onEditHost={noop}
        onDeleteHost={noop}
        onRenameGroup={noop}
        onDeleteGroup={noop}
      />,
    )
    expect(screen.getByTestId('host-search')).toBeInTheDocument()
    expect(screen.getByTestId('host-group-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('host-list-pagination')).not.toBeInTheDocument()
  })

  it('filters hosts in the selected group by label or hostname', () => {
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
    fireEvent.click(screen.getByTestId('host-group-select-g1'))
    fireEvent.change(screen.getByTestId('host-search'), { target: { value: 'db' } })
    expect(screen.getByTestId('host-row-h2')).toBeInTheDocument()
    expect(screen.queryByTestId('host-row-h1')).not.toBeInTheDocument()

    fireEvent.change(screen.getByTestId('host-search'), { target: { value: 'a.example' } })
    expect(screen.getByTestId('host-row-h1')).toBeInTheDocument()
    expect(screen.queryByTestId('host-row-h2')).not.toBeInTheDocument()
  })

  it('shows an empty-search state and can clear it', () => {
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
    fireEvent.click(screen.getByTestId('host-group-select-g1'))
    fireEvent.change(screen.getByTestId('host-search'), { target: { value: 'no-such-host' } })
    expect(screen.getByTestId('host-search-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('host-row-h1')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('host-search-empty-clear'))
    expect(screen.queryByTestId('host-search-empty')).not.toBeInTheDocument()
    expect(screen.getByTestId('host-row-h1')).toBeInTheDocument()
  })

  it('paginates hosts in the selected group and hides later pages until next', () => {
    const many: TerminalHost[] = Array.from({ length: HOST_LIST_PAGE_SIZE + 3 }, (_, i) => ({
      id: `p${i}`,
      label: `box-${String(i).padStart(2, '0')}`,
      groupId: 'g1',
      hostname: `box${i}.example`,
      port: 22,
      username: 'u',
      authMethod: 'password',
      updatedAt: 1,
    }))
    render(
      <HostGroupList
        groups={[{ id: 'g1', name: 'Prod', sort: 0 }]}
        hosts={many}
        onEditHost={noop}
        onDeleteHost={noop}
        onRenameGroup={noop}
        onDeleteGroup={noop}
      />,
    )
    expect(screen.getByTestId('host-row-p0')).toBeInTheDocument()
    expect(screen.queryByTestId(`host-row-p${HOST_LIST_PAGE_SIZE}`)).not.toBeInTheDocument()
    expect(screen.getByTestId('host-list-pagination')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('terminals.nextPage'))
    expect(screen.queryByTestId('host-row-p0')).not.toBeInTheDocument()
    expect(screen.getByTestId(`host-row-p${HOST_LIST_PAGE_SIZE}`)).toBeInTheDocument()
  })

  it('resets to page 1 when the search query or selected group changes', () => {
    const g1Hosts: TerminalHost[] = Array.from({ length: HOST_LIST_PAGE_SIZE + 2 }, (_, i) => ({
      id: `a${i}`,
      label: `alpha-${String(i).padStart(2, '0')}`,
      groupId: 'ga',
      hostname: `a${i}.example`,
      port: 22,
      username: 'u',
      authMethod: 'password',
      updatedAt: 1,
    }))
    const g2Hosts: TerminalHost[] = Array.from({ length: HOST_LIST_PAGE_SIZE + 2 }, (_, i) => ({
      id: `b${i}`,
      label: `beta-${String(i).padStart(2, '0')}`,
      groupId: 'gb',
      hostname: `b${i}.example`,
      port: 22,
      username: 'u',
      authMethod: 'password',
      updatedAt: 1,
    }))
    render(
      <HostGroupList
        groups={[
          { id: 'ga', name: 'Alpha', sort: 0 },
          { id: 'gb', name: 'Beta', sort: 0 },
        ]}
        hosts={[...g1Hosts, ...g2Hosts]}
        onEditHost={noop}
        onDeleteHost={noop}
        onRenameGroup={noop}
        onDeleteGroup={noop}
      />,
    )
    // Alpha is first by name
    fireEvent.click(screen.getByLabelText('terminals.nextPage'))
    expect(screen.getByTestId(`host-row-a${HOST_LIST_PAGE_SIZE}`)).toBeInTheDocument()

    fireEvent.change(screen.getByTestId('host-search'), { target: { value: 'alpha-00' } })
    expect(screen.getByTestId('host-row-a0')).toBeInTheDocument()
    expect(screen.queryByTestId(`host-row-a${HOST_LIST_PAGE_SIZE}`)).not.toBeInTheDocument()
    expect(screen.queryByTestId('host-list-pagination')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('host-search-clear'))
    fireEvent.click(screen.getByLabelText('terminals.nextPage'))
    fireEvent.click(screen.getByTestId('host-group-select-gb'))
    expect(screen.getByTestId('host-row-b0')).toBeInTheDocument()
    expect(screen.queryByTestId(`host-row-b${HOST_LIST_PAGE_SIZE}`)).not.toBeInTheDocument()
  })
})
