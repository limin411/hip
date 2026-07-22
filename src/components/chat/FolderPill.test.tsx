// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'
import { useDomainStore } from '@/domain'
import { DEFAULT_CONFIG } from '@/domain/sessionStore'
import { useDraftStore } from '@/store/draftStore'
import i18n from '@/i18n'

const pickDirectory = vi.fn()
vi.mock('@/ipc/dialog', () => ({
  pickDirectory: (...args: unknown[]) => pickDirectory(...args),
}))

vi.mock('@/components/ui/DropdownMenu', async () => {
  const R = await import('react')
  return {
    DropdownMenu: ({ children }: { children: React.ReactNode }) =>
      R.createElement('div', { 'data-testid': 'dropdown-menu' }, children),
    DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) =>
      R.createElement('div', { 'data-testid': 'dropdown-trigger' }, children),
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) =>
      R.createElement('div', { 'data-testid': 'dropdown-content' }, children),
    DropdownMenuItem: ({
      children,
      onSelect,
      ...rest
    }: {
      children: React.ReactNode
      onSelect?: () => void
      'data-testid'?: string
      'data-path'?: string
      title?: string
    }) =>
      R.createElement(
        'button',
        {
          type: 'button',
          'data-testid': rest['data-testid'] ?? 'dropdown-item',
          'data-path': rest['data-path'],
          title: rest.title,
          onClick: onSelect,
        },
        children,
      ),
    DropdownMenuLabel: ({ children }: { children: React.ReactNode }) =>
      R.createElement('div', { 'data-testid': 'dropdown-label' }, children),
  }
})

import { FolderPill } from './FolderPill'

function setSessions(
  items: Array<{ id: string; cwd?: string; updatedAtMs?: number; surface?: 'code' | 'chat' }>,
) {
  useDomainStore.setState({
    sessions: items.map((s) => ({
      id: s.id,
      title: s.id,
      preview: '',
      updatedAtMs: s.updatedAtMs ?? 1,
      config: {
        ...DEFAULT_CONFIG,
        surface: s.surface ?? 'code',
        ...(s.cwd ? { cwd: s.cwd } : {}),
      },
      messages: [],
      status: 'idle' as const,
      loaded: true,
    })),
    activeSessionId: null,
  } as never)
}

describe('FolderPill', () => {
  beforeEach(async () => {
    cleanup()
    pickDirectory.mockReset()
    useDraftStore.setState({ draft: null })
    useDomainStore.setState({ sessions: [], activeSessionId: null } as never)
    await i18n.changeLanguage('en')
  })

  afterEach(() => {
    cleanup()
  })

  it('shows pick-folder without quick select when no open project dirs', () => {
    render(<FolderPill />)
    expect(screen.getByTestId('pick-folder')).toBeInTheDocument()
    expect(screen.queryByTestId('quick-pick-folder')).not.toBeInTheDocument()
  })

  it('shows quick select to the left of pick-folder when open project dirs exist', () => {
    setSessions([
      { id: 's1', cwd: '/Users/me/proj-a', updatedAtMs: 10 },
      { id: 's2', cwd: '/Users/me/proj-b', updatedAtMs: 20 },
    ])
    render(<FolderPill />)
    const row = screen.getByTestId('folder-pill-row')
    expect(row.firstElementChild).toHaveAttribute('data-testid', 'dropdown-menu')
    expect(screen.getByTestId('quick-pick-folder')).toBeInTheDocument()
    expect(screen.getByTestId('pick-folder')).toBeInTheDocument()
    expect(screen.getByText('proj-b')).toBeInTheDocument()
    expect(screen.getByText('proj-a')).toBeInTheDocument()
  })

  it('selecting a quick folder binds the draft project cwd', () => {
    setSessions([{ id: 's1', cwd: '/Users/me/hip', updatedAtMs: 1 }])
    render(<FolderPill />)
    fireEvent.click(screen.getByTestId('quick-pick-folder-item'))
    const draft = useDraftStore.getState().draft
    expect(draft?.mode).toBe('project')
    expect(draft?.cwd).toBe('/Users/me/hip')
  })

  it('keeps quick select when a folder is already bound', () => {
    setSessions([{ id: 's1', cwd: '/Users/me/hip', updatedAtMs: 1 }])
    useDraftStore.setState({
      draft: { tempId: 'd1', mode: 'project', cwd: '/Users/me/hip', text: '' },
    })
    render(<FolderPill />)
    expect(screen.getByTestId('quick-pick-folder')).toBeInTheDocument()
    expect(screen.getByTestId('folder-chip')).toBeInTheDocument()
  })
})
